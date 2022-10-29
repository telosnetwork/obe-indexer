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

    async loadTokenList() {
        const { data, status } = await axios.get<TokenList>(this.indexer.config.tokenListUrl);
        if (status !== 200) {
            throw new Error(`Failed to fetch tokenlist from ${this.indexer.config.tokenListUrl}`)
        }
        this.tokens = data.tokens;
        this.tokens.forEach(token => token.id = `${token.account}:${token.symbol}`)
    }

    async run() {
        for (const token of this.tokens) {
            try {
                await this.doToken(token);
            } catch (e) {
                console.error(`Failure in doToken for ${token.name}`, e);
            }
        }
    }

    private async doToken(token: Token) {
        const lastBlock = await this.getLastBlock(token);
        if (lastBlock == 0) {
            await this.loadHolders(token);
        }
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
            break;
        }

        console.log(`Found ${count} holders for ${token.name}`);
        for (const holder of holders) {
            await this.loadHolder(token, holder);
        }
    }

    private async loadHolder(token: Token, account: Name) {
        const response = await this.chainApi.get_table_rows({
            code: token.account,
            scope: account,
            table: 'accounts',
            type: AccountRow,
            limit: 200
        });

        if (!response || response.rows.length === 0) {
            console.error(`Unable to find balance for ${account.toString()} in ${token.account} with symbol ${token.symbol}`);
        } else {
            for (const row of response.rows) {
                const balance = String(row.balance.units);
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
}
