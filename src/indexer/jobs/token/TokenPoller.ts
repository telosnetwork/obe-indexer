import axios from 'axios'
import {Token, TokenList} from '../../../types/tokens'
import Indexer from '../../Indexer'
import {sql} from 'slonik'
import {Asset, ChainAPI, Name, Struct} from '@greymass/eosio'
import {createLogger} from "../../../util/logger";
import {getTableLastBlock, getLastActionsBlock, setLastActionBlock} from "../../../util/utils";
import {loadDelegated, loadRexBalances, loadDelegatedIncremental, loadRexBalancesIncremental} from "./TelosHandler";

@Struct.type('account')
export class AccountRow extends Struct {
    @Struct.field(Asset) balance!: Asset
}

@Struct.type('stat')
export class StatRow extends Struct {
    @Struct.field(Asset) supply!: Asset
}

const logger = createLogger('TokenPoller', 'indexer');

export const POLLER_ID = 'token';

export default class TokenPoller {
    private tokens: Token[] = [];
    private indexer: Indexer;
    private chainApi: ChainAPI;
    private currentLibBlock = 0;
    private lastPollTime = 0;
    private lastTokenlistTime = 0;
    private lastRexTime = 0;

    constructor(indexer: Indexer) {
        this.indexer = indexer;
        this.chainApi = this.indexer.antelopeCore.v1.chain;
    }

    async init() {
        return await this.loadTokenList();
    }

    async loadTokenList() {
        const {data, status} = await axios.get<TokenList>(
            this.indexer.config.tokenListUrl
        );
        if (status !== 200) {
            throw new Error(
                `Failed to fetch tokenlist from ${this.indexer.config.tokenListUrl}`
            );
        }
        this.tokens = data.tokens;
        this.tokens.forEach(
            token => token.id = `${token.account.toLowerCase()}:${token.symbol.toUpperCase()}`
        )
        this.lastTokenlistTime = new Date().getTime();
    }

    async run() {

        let now = new Date();
        if ((this.lastTokenlistTime + (this.indexer.config.tokenListInterval * 60 * 1000)) < now.getTime()) {
            await this.loadTokenList();
        }

        if ((this.lastPollTime + (this.indexer.config.tokenPollInterval * 60 * 1000)) > now.getTime()) {
            return;
        }
        this.lastPollTime = now.getTime()
        logger.info(`Starting do tokens..`)
        for (const token of this.tokens) {
            try {
                await this.doToken(token);
                await this.cleanBalances(token);
            } catch (e) {
                logger.error(`Failure in doToken for ${token.name}: ${e}`);
            }
        }
        logger.info(`Do tokens complete!!`);
    }

    private async cleanBalances(token: Token){
        try {
            await this.indexer.dbPool?.query(sql`DELETE FROM balances WHERE liquid_balance = 0 AND resource_stake = 0 AND rex_stake = 0 AND token = ${token.id}`);
            logger.info(`Removed all empty balances of ${token.name} (${token.symbol})`);
        } catch (e) {
            logger.error(`Could not remove empty balances for ${token.name} (${token.symbol}): ${e}`);
        }
    }
    private async doToken(token: Token) {
        logger.info(`Start of ${token.name} (${token.symbol})`);
        const lastBlock = await this.getTokenLastBlock(token);
        const currentLib = await this.setLib();
        if (lastBlock === 0) {
            await this.doFullTokenLoad(currentLib, token);
        } else {
            await this.doTokenIncremental(lastBlock, token);
        }
        if (token.id === `${this.indexer.config.baseCurrencyContract}:${this.indexer.config.baseCurrencySymbol}`) {
            await this.doStakeBalances(token);
        }
        logger.info(`End of ${token.name} (${token.symbol})`);
    }

    private async doStakeBalances(token: Token) {
        logger.info(`Start of ${token.name} rex / delegated`);
        const now = new Date().getTime();
        const rexPollInterval = this.indexer.config.rexPollInterval * 60 * 1000;

        // Delegation
        const lastDelegationTableBlock: number = await getTableLastBlock('delegations', this.indexer);
        let lastDelegationTime = 0;
        if(lastDelegationTableBlock > 0) {
            const responseDelegation = await this.chainApi.get_block(lastDelegationTableBlock);
            lastDelegationTime = responseDelegation.timestamp.toMilliseconds();
            if ((lastDelegationTime + rexPollInterval) < now) {
                logger.info(`Doing incremental REX delegations for ${token.name} (${token.symbol})...`);
                await loadDelegatedIncremental(token, this.currentLibBlock, lastDelegationTableBlock, POLLER_ID, this.indexer, this.chainApi);
            } else {
                logger.info(`Delegation polling is still in timeout`);
            }
        } else {
            logger.info(`Doing full REX delegations for ${token.name} (${token.symbol})...`);
            await loadDelegated(token, this.currentLibBlock, this.indexer);
        }

        // Rex balances
        const lastRexBalancesBlock: number = await getLastActionsBlock(['eosio:buyrex', 'eosio:sellrex'], POLLER_ID, this.indexer);
        if(lastRexBalancesBlock > 0){
            const rexBalancesResponse = await this.chainApi.get_block(lastRexBalancesBlock);
            const lastRexBalancesTime = rexBalancesResponse.timestamp.toMilliseconds();
            if ((lastRexBalancesTime + rexPollInterval) < now) {
                logger.info(`Doing incremental REX balances`);
                await loadRexBalancesIncremental(token, this.currentLibBlock, lastRexBalancesBlock, POLLER_ID, this.indexer, this.chainApi);
            }
        } else {
            logger.info(`Doing full REX balances`);
            await loadRexBalances(token, this.currentLibBlock, this.indexer);
            await setLastActionBlock('eosio:buyrex', POLLER_ID, this.currentLibBlock, this.indexer);
        }
    }
    private async getTokenLastBlock(token: Token): Promise<number> {
        try {
            const tokenRow = await this.indexer.dbPool?.maybeOne(
                sql`SELECT last_block
                from tokens
                where id = ${token.id}`
            );
            if (tokenRow) {
                logger.info(`Last block found for ${token.name} (${token.symbol}) : ${tokenRow.last_block }`);
                return tokenRow.last_block as number;
            }
        } catch (e) {
            logger.error(`Could not retreive last block on token table for ${token.name} (${token.symbol}) : ${e}`);
        }

        try {
            await this.indexer.dbPool?.query(
                sql`INSERT INTO tokens (id, last_block)
                    VALUES (${token.id}, 0)`
            );
            logger.info(`No last block found for ${token.name} (${token.symbol}), has been set to 0`);
            return 0;
        } catch (e) {
            logger.error(`Could not set last block to 0 on token table for ${token.name} (${token.symbol}) : ${e}`);
            return 0;
        }
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
            logger.error(`Unable to find stat row for token: ${token.name} (${token.symbol})`);
            return;
        }

        return statResponse.rows[0];
    }

    private async doFullTokenLoad(currentBlock: number, token: Token) {
        logger.info(`Starting full load of ${token.name} (${token.symbol})...`);
        let more = true;
        let nextKey = '';
        let count = 0;
        let holders: Name[] = [];

        const statRow: StatRow | undefined = await this.getStatRow(token);
        if (!statRow) {
            logger.error(`Cannot do full token load, unable to find stat row for ${token.name} (${token.symbol})`);
            return;
        };

        await this.updateTokenSupply(token, statRow);

        while (more) {
            const response = await this.chainApi.get_table_by_scope({
                code: token.account,
                table: 'accounts',
                lower_bound: nextKey,
                limit: 500,
            });

            if (response.more && response.more !== '') {
                more = true;
                nextKey = response.more;
            } else {
                more = false;
            }
            count += response.rows.length;
            holders = holders.concat(
                response.rows.map((r) => Name.from(r.scope))
            );
            logger.info(`Found ${count} holders for ${token.name} (${token.symbol})`);
        }

        logger.info(
            `Loading balances for ${count} total holders of ${token.name} (${token.symbol})`
        );

        await this.loadHolders(currentBlock, token, holders);

        logger.info(`${token.name} (${token.symbol}) all ${count} completed`);

        try {
            await this.indexer.dbPool?.query(sql`UPDATE balances SET liquid_balance = 0 WHERE block != ${currentBlock} AND token = ${token.id}`);
            logger.info(`Removed all balances not seen on this full load of ${token.name} (${token.symbol})`);
        } catch (e) {
            logger.error(`Could not remove old balances for ${token.name} (${token.symbol}): ${e}`);
        }


        try {
            await this.indexer.dbPool?.query(sql`UPDATE tokens SET last_block = ${currentBlock} WHERE id = ${token.id}`);
            logger.info(`Saved last block for ${token.name} (${token.symbol}): ${currentBlock}`);
        } catch (e) {
            logger.error(`Could not update last block for ${token.name} (${token.symbol}): ${e}`);
        }

    }

    private async loadHolders(currentBlock: number, token: Token, holders: Name[] | Set<Name>) {
        let holderPromiseBatch = [];
        const batchSize = 10;
        let loadedCount = 0;
        logger.info(`Loading holders for ${token.name} (${token.symbol})...`);
        for (const holder of holders) {
            holderPromiseBatch.push(this.loadHolder(currentBlock, token, holder));

            if (holderPromiseBatch.length >= batchSize) {
                loadedCount += holderPromiseBatch.length;
                await Promise.all(holderPromiseBatch);
                holderPromiseBatch = [];
                logger.info(`Loaded ${loadedCount} ${token.name} (${token.symbol}) accounts...`);
            }
        }

        if (holderPromiseBatch.length >= 1) {
            loadedCount += holderPromiseBatch.length;
            await Promise.all(holderPromiseBatch);
            logger.info(`Loaded ${loadedCount} ${token.name} (${token.symbol}) accounts...`);
        }
    }

    private async loadHolder(currentBlock: number, token: Token, account: Name) {
        const response = await this.chainApi.get_table_rows({
            code: token.account,
            // TOOD: once there's a better way to handle accounts like '1' besides adding the space as below, fix this and don't have the space
            scope: `${String(account)} `,
            table: 'accounts',
            type: AccountRow,
            limit: 200,
        });

        if (!response || response.rows.length === 0) {
            logger.error(
                `Unable to find balance for ${account.toString()} in ${
                    token.account
                } with symbol ${token.symbol}`
            );
        } else {
            for (const row of response.rows) {
                const balance = String(row.balance.units);
                const accountStr = account.toString();
                const query = sql`
                    INSERT INTO balances (block, token, account, liquid_balance, total_balance, rex_stake, resource_stake)
                    VALUES (${currentBlock}, ${token.id}, ${accountStr}, ${balance}, ${balance}, 0, 0)
                    ON CONFLICT ON CONSTRAINT balances_pkey
                        DO UPDATE
                        SET liquid_balance = EXCLUDED.liquid_balance,
                            total_balance = COALESCE(EXCLUDED.liquid_balance, 0) + COALESCE(balances.rex_stake, 0) + COALESCE(balances.resource_stake, 0),
                            block   = EXCLUDED.block
                        WHERE balances.token = ${token.id} AND balances.account = ${accountStr}
                `;
                await this.indexer.dbPool?.query(query);
            }
        }
    }

    private async doTokenIncremental(lastBlock: number, token: Token) {
        logger.info(`Starting incremental load of ${token.name} (${token.symbol})...`);
        const startBlockResponse = await this.chainApi.get_block(lastBlock);
        const startISO = new Date(startBlockResponse.timestamp.toMilliseconds()).toISOString();
        const endBlockResponse = await this.chainApi.get_block(this.currentLibBlock);
        const endBlock = endBlockResponse.block_num.toNumber();
        const endISO = new Date(endBlockResponse.timestamp.toMilliseconds()).toISOString();

        const statRow: StatRow | undefined = await this.getStatRow(token);
        if (!statRow) {
            logger.error(`Cannot do incremental updates, unable to find stat row for ${token.id}`);
            return;
        }

        await this.updateTokenSupply(token, statRow);

        const params = {
            after: startISO,
            before: endISO,
            code: token.account,
            table: 'accounts',
            sort: 'asc',
            limit: this.indexer.config.hyperionIncrementLimit
        };
        try {
            const response = await this.indexer.hyperion.get(`v2/history/get_deltas`, {params});
            if (response.data.total.value == 0) {
                logger.info(`${token.name} (${token.symbol}) had no transfers between ${startISO} and ${endISO}`);
                return await this.updateTokenLastBlock(token, endBlock);
            }

            const holders = new Set<Name>();
            for (const delta of response.data.deltas) {
                if (delta.data.symbol !== token.symbol) {
                    // This is not an error, a contract can store many different symbols
                    continue;
                }

                if (delta.code !== token.account) {
                    logger.error(`Got a delta with incorrect code, expected ${token.account} but got ${delta.code}`);
                    continue;
                }

                holders.add(delta.scope);
            }

            logger.info(`Found ${holders.size} account balances changed for ${token.name} (${token.symbol}) between ${startISO}-${endISO}`);
            await this.loadHolders(endBlock, token, holders);
        } catch (e) {
            throw `Could not get accounts table deltas from hyperion for token ${token.name} (${token.account}), make sure the configured node is available: ${e}`;
            // This can happen if node is 404... Throw it so someone can restart the app & look at it, else the data is going to be false and we will not be able to catch it short of a full reload.
        }

        return await this.updateTokenLastBlock(token, endBlock);
    }

    private async setLib() {
        // TODO: maybe here we should look at how long ago this was and skip it if it's say... less than 5 seconds old
        const getInfo = await this.chainApi.get_info();
        this.currentLibBlock = getInfo.last_irreversible_block_num.toNumber();
        return this.currentLibBlock;
    }

    private async updateTokenLastBlock(token: Token, block: number) {
        try {
            return await this.indexer.dbPool?.query(sql`UPDATE tokens SET last_block = ${block}  WHERE id = ${token.id}`);
        } catch (e) {
            logger.error(`Could not update token ${token.name} (${token.symbol}) last block to ${block} : ${e}`);
        }
        return false;
    }
    private async updateTokenSupply(token: Token, statRow: StatRow) {
        const supply = statRow.supply.toString();
        try {
            return await this.indexer.dbPool?.query(sql`UPDATE tokens SET supply = ${supply} WHERE id = ${token.id}`);
        } catch (e) {
            logger.error(`Could not update token ${token.name} (${token.symbol}) supply to ${supply} : ${e}`);
        }
        return false;
    }
}