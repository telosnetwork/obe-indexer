import axios from 'axios'
import {Token, TokenList} from '../../../types/tokens'
import Indexer from '../../Indexer'
import {sql} from 'slonik'
import {Asset, ChainAPI, Name, Struct} from '@greymass/eosio'
import {createLogger} from "../../../util/logger";
import {updateRexBalances} from "./TelosHandler";

@Struct.type('account')
export class AccountRow extends Struct {
    @Struct.field(Asset) balance!: Asset
}

@Struct.type('stat')
export class StatRow extends Struct {
    @Struct.field(Asset) supply!: Asset
}

const logger = createLogger('TokenPoller')

// 2min for updating token balances
const POLL_INTERVAL = 2 * 60 * 1000

const TOKENLIST_INTERVAL = 2 * 60 * 60 * 1000

// 12hrs for polling REX balances
const REX_POLL_INTERVAL = 12 * 60 * 60 * 1000

export default class TokenPoller {
    private tokens: Token[] = [];
    private indexer: Indexer
    private chainApi: ChainAPI
    private lastPollTime = 0
    private lastTokenlistTime = 0
    private lastRexTime = 0
    private currentLibBlock = 0

    constructor(indexer: Indexer) {
        this.indexer = indexer
        this.chainApi = this.indexer.antelopeCore.v1.chain
    }

    async init() {
        return this.loadTokenList()
    }

    async loadTokenList() {
        const {data, status} = await axios.get<TokenList>(
            this.indexer.config.tokenListUrl
        )
        if (status !== 200) {
            throw new Error(
                `Failed to fetch tokenlist from ${this.indexer.config.tokenListUrl}`
            )
        }
        this.tokens = data.tokens
        this.tokens.forEach(
            token => token.id = `${token.account.toLowerCase()}:${token.symbol.toUpperCase()}`
        )
        this.lastTokenlistTime = new Date().getTime()
    }

    async run() {
        let now = new Date();
        if ((this.lastTokenlistTime + TOKENLIST_INTERVAL) < now.getTime()) {
            await this.loadTokenList()
        }

        if ((this.lastPollTime + POLL_INTERVAL) > now.getTime()) {
            return
        }
        this.lastPollTime = now.getTime()
        logger.info(`Starting do tokens..`)
        for (const token of this.tokens) {
            try {
                await this.doToken(token)
                // TODO: Some cleaup action that finds any balances with zero values for all of liquid/rex/resources and deletes them
            } catch (e) {
                logger.error(`Failure in doToken for ${token.name}: ${e}`)
            }
        }
        logger.info(`Do tokens complete!!`)
    }

    private async doToken(token: Token) {
        logger.info(`Start of ${token.name}`)
        const lastBlock = await this.getLastBlock(token)
        await this.setLib()
        const currentLib = this.currentLibBlock

        if (lastBlock == 0) {
            await this.doFullTokenLoad(currentLib, token)
        } else {
            await this.pollTransfersSince(lastBlock, token)
        }
        if (token.id == `eosio.token:TLOS`) {
            await this.doStakeBalances(token)
        }
        logger.info(`End of ${token.name}`)
    }

    private async doStakeBalances(token: Token) {
        const now = new Date().getTime()
        if ((this.lastRexTime + REX_POLL_INTERVAL) > now) {
            return;
        }

        this.lastRexTime = now
        logger.info(`Doing stake balances for ${token.id}`)
        await updateRexBalances(token, this.currentLibBlock, this.indexer)
        logger.info(`Done doing stake balances for TLOS`)
    }

    private async getLastBlock(token: Token): Promise<number> {
        const tokenRow = await this.indexer.dbPool?.maybeOne(
            sql`SELECT last_block
                from tokens
                where id = ${token.id}`
        )
        if (tokenRow) {
            return tokenRow.last_block as number
        }

        await this.indexer.dbPool?.query(
            sql`INSERT INTO tokens (id, last_block)
                VALUES (${token.id}, 0)`
        )
        return 0
    }

    private async getStatRow(token: Token): Promise<StatRow | undefined> {
        const statResponse = await this.indexer.antelopeCore.v1.chain.get_table_rows({
            code: token.account,
            scope: token.symbol,
            table: 'stat',
            limit: 500,
            type: StatRow
        });

        if (!statResponse || statResponse.rows.length !== 1) {
            logger.error(`Unable to find stat row for token: ${token.id}`)
            return
        }

        return statResponse.rows[0];
    }

    // TODO: maybe this should be done daily?
    private async doFullTokenLoad(currentBlock: number, token: Token) {
        logger.info(`Starting full load of ${token.name}`)
        let more = true
        let nextKey = ''
        let count = 0
        let holders: Name[] = []

        const statRow: StatRow | undefined = await this.getStatRow(token)
        if (!statRow) {
            logger.error(`Cannot do full token load, unable to find stat row for ${token.id}`)
            return
        }

        await this.updateTokenSupply(token, statRow);

        while (more) {
            const response = await this.chainApi.get_table_by_scope({
                code: token.account,
                table: 'accounts',
                lower_bound: nextKey,
                limit: 500,
            })

            if (response.more && response.more !== '') {
                more = true
                nextKey = response.more
            } else {
                more = false
            }
            count += response.rows.length
            holders = holders.concat(
                response.rows.map((r) => Name.from(r.scope))
            )
            logger.info(`Found ${count} holders for ${token.name}`)
        }

        logger.info(
            `Loading balances for ${count} total holders of ${token.name}`
        )

        await this.loadHolders(currentBlock, token, holders)

        logger.info(`${token.name} all ${count} completed`)

        await this.indexer.dbPool?.query(sql`UPDATE balances
                                             SET liquid_balance = 0
                                             WHERE block != ${currentBlock} AND token = ${token.id}`)

        await this.indexer.dbPool?.query(sql`UPDATE tokens
                                             SET last_block = ${currentBlock}
                                             WHERE id = ${token.id}`)

        logger.info(`Removed all balances not seen on this full load of ${token.name}`)
    }

    private async loadHolders(currentBlock: number, token: Token, holders: Name[] | Set<Name>) {
        let holderPromiseBatch = []
        const batchSize = 10
        let loadedCount = 0
        for (const holder of holders) {
            holderPromiseBatch.push(this.loadHolder(currentBlock, token, holder))

            if (holderPromiseBatch.length >= batchSize) {
                loadedCount += holderPromiseBatch.length
                await Promise.all(holderPromiseBatch)
                holderPromiseBatch = []
                logger.info(`Loaded ${loadedCount} $${token.name} accounts...`)
            }
        }

        if (holderPromiseBatch.length >= 1) {
            loadedCount += holderPromiseBatch.length
            await Promise.all(holderPromiseBatch)
            logger.info(`Loaded ${loadedCount} ${token.name} accounts...`)
        }
    }

    private async loadHolder(currentBlock: number, token: Token, account: Name) {
        const response = await this.chainApi.get_table_rows({
            code: token.account,
            scope: `${String(account)} `,
            table: 'accounts',
            type: AccountRow,
            limit: 200,
        })

        if (!response || response.rows.length === 0) {
            logger.error(
                `Unable to find balance for ${account.toString()} in ${
                    token.account
                } with symbol ${token.symbol}`
            )
        } else {
            for (const row of response.rows) {
                const balance = String(row.balance.units)
                const accountStr = account.toString()
                const query = sql`
                    INSERT INTO balances (block, token, account, liquid_balance, total_balance, rex_stake, resource_stake)
                    VALUES (${currentBlock}, ${token.id}, ${accountStr}, ${balance}, ${balance}, 0, 0)
                    ON CONFLICT ON CONSTRAINT balances_pkey
                        DO UPDATE
                        SET liquid_balance = EXCLUDED.liquid_balance,
                            total_balance = COALESCE(EXCLUDED.liquid_balance, 0) + COALESCE(balances.rex_stake, 0) + COALESCE(balances.resource_stake, 0),
                            block   = EXCLUDED.block`
                await this.indexer.dbPool?.query(query)
            }
        }
    }

    private async pollTransfersSince(lastBlock: number, token: Token) {
        const startBlockResponse = await this.chainApi.get_block(lastBlock)
        const startISO = new Date(startBlockResponse.timestamp.toMilliseconds()).toISOString();
        const endBlockResponse = await this.chainApi.get_block(this.currentLibBlock)
        const endBlock = endBlockResponse.block_num.toNumber();
        const endISO = new Date(endBlockResponse.timestamp.toMilliseconds()).toISOString();

        const statRow: StatRow | undefined = await this.getStatRow(token)
        if (!statRow) {
            logger.error(`Cannot do incremental updates, unable to find stat row for ${token.id}`)
            return
        }

        await this.updateTokenSupply(token, statRow);

        const params = {
            after: startISO,
            before: endISO,
            code: token.account,
            table: 'accounts'
        }
        // TODO: paginate here
        const response = await this.indexer.hyperion.get(`v2/history/get_deltas`, {params})
        if (response.data.total.value == 0) {
            logger.info(`${token.name} had no transfers between ${startISO} and ${endISO}`)
            const updateResult = await this.indexer.dbPool?.query(sql`UPDATE tokens
                                                                      SET last_block = ${endBlock}
                                                                      WHERE id = ${token.id}`)
            return;
        }

        const holders = new Set<Name>()
        for (const delta of response.data.deltas) {
            if (delta.data.symbol !== token.symbol) {
                // This is not an error, a contract can store many different symbols
                continue
            }

            if (delta.code !== token.account) {
                logger.error(`Got a delta with incorrect code, expected ${token.account} but got ${delta.code}`)
                continue
            }

            holders.add(delta.scope)
        }

        logger.info(`Found ${holders.size} account balances changed for ${token.name} between ${startISO}-${endISO}`)
        await this.loadHolders(endBlock, token, holders);

        const updateResult = await this.indexer.dbPool?.query(sql`UPDATE tokens
                                                                  SET last_block = ${endBlock}
                                                                  WHERE id = ${token.id}`)
    }

    private async setLib() {
        // TODO: maybe here we should look at how long ago this was and skip it if it's say... less than 5 seconds old
        const getInfo = await this.chainApi.get_info()
        this.currentLibBlock = getInfo.last_irreversible_block_num.toNumber()
    }

    private async updateTokenSupply(token: Token, statRow: StatRow) {
        await this.indexer.dbPool?.query(sql`UPDATE tokens
                                             SET supply = ${statRow.supply.toString()}
                                             WHERE id = ${token.id}`)
    }
}
