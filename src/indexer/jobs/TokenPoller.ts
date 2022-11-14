import axios from 'axios';
import {AccountRow, Token, TokenList, TokenRow} from "../../types/tokens";
import Indexer from "../Indexer";
import {sql} from "slonik";
import {ChainAPI, Name} from "@greymass/eosio";

export default class TokenPoller {

    private tokens: Token[] = [];
    private indexer: Indexer;
    private chainApi: ChainAPI;

    constructor(indexer: Indexer) {
        this.indexer = indexer;
        this.chainApi = this.indexer.antelopeCore.v1.chain;
    }

    async init() {
        return this.loadTokenList();
    }

    // TODO: this on some hourly interval
    async loadTokenList() {
        const { data, status } = await axios.get<TokenList>(this.indexer.config.tokenListUrl);
        if (status !== 200) {
            throw new Error(`Failed to fetch tokenlist from ${this.indexer.config.tokenListUrl}`)
        }
        this.tokens = data.tokens;
        this.tokens.forEach(token => token.id = `${token.account}:${token.symbol}`)
    }

    async run() {
        const start = new Date();
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`Start of all tokens : ${start}`);
        console.log(`Starting do tokens..`)
        for (const token of this.tokens) {
            try {
                await this.doToken(token);
            } catch (e) {
                console.error(`Failure in doToken for ${token.name}`, e);
            }
        }
        console.log(`Do tokens complete!!`)
        const end = new Date();
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`End of all tokens : ${end}`);
    }

    private async doToken(token: Token) {
        const start = new Date();
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`Start of ${token.name} : ${start}`);
        const lastBlock = await this.getLastBlock(token);
        if (lastBlock == 0) {
            await this.loadHolders(token);
        } else {
            // TODO: this...
            //await this.pollTransfersSince(lastBlock, token);
        }
        const end = new Date();
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        console.log(`Start of ${token.name} : ${end}`);
    }

    private async getLastBlock(token: Token) {
        const tokenRow = await this.indexer.dbPool?.maybeOne(sql`SELECT last_block from tokens where id=${token.id}`);
        if (tokenRow) {
            return tokenRow.last_block;
        }

        await this.indexer.dbPool?.query(sql`INSERT INTO tokens (id, last_block) VALUES(${token.id}, 0)`)
        return 0;
    }

    private async loadHolders(token: Token) {
        console.log(`Starting full load of ${token.name}`);
        let more = true;
        let nextKey = '';
        let count = 0;
        let holders: Name[] = [];
        while (more) {
            const response = await this.chainApi.get_table_by_scope({
                code: token.account,
                table: 'accounts',
                lower_bound: nextKey,
                limit: 500
            })

            if (response.more && response.more !== '') {
                more = true;
                nextKey = response.more;
            } else {
                more = false;
            }
            count += response.rows.length;
            holders = holders.concat(response.rows.map(r => Name.from(r.scope)));
            console.log(`Found ${count} holders for ${token.name}`);
        }

        console.log(`Loading balances for ${count} total holders of ${token.name}`);
        let holderPromiseBatch = [];
        const batchSize = 10;
        let loadedCount = 0;
        for (const holder of holders) {
            holderPromiseBatch.push(this.loadHolder(token, holder));

            if (holderPromiseBatch.length >= batchSize) {
                loadedCount += holderPromiseBatch.length;
                await Promise.all(holderPromiseBatch);
                holderPromiseBatch =[];
                console.log(`Loaded ${loadedCount} $${token.name} accounts...`);
            }
        }

        if (holderPromiseBatch.length >= 1) {
            loadedCount += holderPromiseBatch.length;
            await Promise.all(holderPromiseBatch);
            console.log(`Loaded ${loadedCount} ${token.name} accounts...`);
        }
        console.log(`${token.name} all ${count} completed`);
    }

    private async loadHolder(token: Token, account: Name) {
        const response = await this.chainApi.get_table_rows({
            code: token.account,
            scope: `${String(account)} `,
            table: 'accounts',
            limit: 200
        });

        if (!response || response.rows.length === 0) {
            console.error(`Unable to find balance for ${account.toString()} in ${token.account} with symbol ${token.symbol}`);
        } else {
            for (const row of response.rows) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const accountRow: AccountRow = row;
                const balance = this.balanceToIntString(accountRow.balance);
                const accountStr = account.toString();
                const query = sql`
                    INSERT INTO balances (token, account, balance)
                    VALUES (${token.id}, ${accountStr}, ${balance})
                    ON CONFLICT ON CONSTRAINT balances_pkey
                    DO UPDATE
                    SET balance = ${balance}`
                await this.indexer.dbPool?.query(query);
            }
        }
    }

    private balanceToIntString(balance: string) : string {
        const decimalBalance = balance.split(' ')[0];
        const intBalance = decimalBalance.replace('.', '').replace(/^0*/, '');
        return intBalance === '' ? '0' : intBalance;
    }
}