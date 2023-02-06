import {RetryFetchOpts} from "../types/configs";
import {RequestInit} from "node-fetch";
import {Type } from '@sinclair/typebox'
import {ChainAPI, APIClient} from "@greymass/eosio";
import {createLogger} from "./logger";
import Indexer from "../indexer/Indexer";
const logger = createLogger('Common utils', 'indexer');
import bigDecimal from "js-big-decimal";
import {sql} from "slonik";

/* FETCH */
export function makeRetryFetch(retryOpts: RetryFetchOpts) {
    return async (url: string, opts: RequestInit) => {
        let retry = retryOpts && retryOpts.attempts || 3

        while (retry > 0) {
            try {
                return await import('node-fetch').then(({default: fetch}) => fetch(url, opts))
            } catch (e) {
                retry = retry - 1
                if (retry === 0) {
                    throw e
                }

                if (retryOpts && retryOpts.delay) {
                    if (retryOpts && !retryOpts.silent) console.log("pausing..")
                    await sleep(retryOpts.delay)
                    if (retryOpts && !retryOpts.silent) console.log("done pausing...")
                }
            }
        }
    };
}

/* DECIMALS */
export function decimalsFromSupply(supply: string) {
    return supply.split(' ')[0].split('.')[1].length
}
export function balanceToDecimals(balance: string, decimals: number): string {
    const len = balance.length;
    if (len <= decimals)
        return `0.${balance.padStart(decimals, '0')}`;

    return `${balance.substring(0, len - decimals)}.${balance.substring(len - decimals)}`;
}
export function toWei(amount: string | number | bigDecimal, precision: number){
    return bigDecimal.multiply(amount, Math.pow(10 , precision));
}

/* ANTELOPE ACTIONS  */
export const setLastActionBlock = async (action: string, poller: string, block: number, indexer: Indexer) => {
    if(action.length === 0 || poller.length === 0 || block === 0) return;
    logger.info(`Setting last block, ${block}, for action ${action} of ${poller} poller...`);
    try {
        await indexer.dbPool?.query(sql`
            INSERT INTO sync_status (block, action, poller)
            VALUES (${block}, ${action}, ${poller})
            ON CONFLICT ON CONSTRAINT sync_status_pkey
                DO UPDATE
                SET block = EXCLUDED.block
        `);
    } catch (e) {
        logger.error(`Could not set last block, ${block}, of action ${action} for ${poller} poller: ${e}`);
    }
    return 0;
}
export const getLastActionBlockISO= async (action: string, poller: string, indexer: Indexer, chainAPI: ChainAPI, fallbackBlock: number, offset: number) => {
    const lastActionBlock = await getLastActionBlock(action, poller, indexer);
    const block = (lastActionBlock || fallbackBlock) + offset;
    const response = await chainAPI.get_block(block);
    return new Date(response.timestamp.toMilliseconds()).toISOString();
}
export const getLastActionsBlock = async (actions: Array<string>, poller: string, indexer: Indexer) => {
    try {
        const row = await indexer.dbPool?.maybeOne(sql`SELECT MAX(block) as block FROM sync_status WHERE action = ANY(${sql.array(actions, 'text')}) AND poller = ${poller}`);
        if(!row) return 0; // Nothing found
        logger.debug(`Last block found for ${actions.length} action(s) of the ${poller} poller : ${row.block}`)
        return row.block as number || 0;
    } catch (e) {
        logger.error(`Could not retreive last block for ${actions.length} action(s) of the ${poller} poller : ${e}`)
        return 0;
    }
}
export const getLastActionBlock = async (action: string, poller: string, indexer: Indexer) => {
    try {
        const row = await indexer.dbPool?.maybeOne(sql`SELECT block FROM sync_status WHERE action = ${action} AND poller = ${poller}`);
        if(!row) return 0; // Nothing found
        logger.debug(`Last block found for the ${action} action of the ${poller} poller : ${row.block}`)
        return row.block as number;
    } catch (e) {
        logger.error(`Could not retreive last block for action ${action} of the ${poller} poller : ${e}`)
        return 0;
    }
}
export async function getActions(indexer: Indexer, poller: string, params: any, lastBlock: number, callback: Function){
    if(Date.parse(params.after) >= Date.parse(params.before)){
        logger.debug(`After date ${params.after} is above or equal to before data ${params.before}, skipping....`)
        return;
    }
    try {
        let count = 0;
        logger.debug(`Handling ${params.filter} action...`);
        const response = await indexer.hyperion.get(`v2/history/get_actions`, { params });
        logger.info(`Received ${response.data.simple_actions.length} ${params.filter} action(s) for ${poller} poller`);
        for (const action of response.data.simple_actions) {
            try {
                await callback(count, action);
                count++;
                // If last iteration and there might be more (limit reached) overwrite last block
                if(lastBlock && count >= indexer.config.hyperionIncrementLimit){
                    lastBlock = action.block;
                }
            } catch (e) {
                logger.error(`Failure doing ${params.filter} action callback for ${poller} poller: ${e}`);
            }
        }
        if(lastBlock){
            await setLastActionBlock(params.filter, poller, lastBlock, indexer)
        }
    } catch (e) {
        logger.error(`Failure retreiving ${params.filter} actions for ${poller} poller: ${e}`);
    }
}

/* ANTELOPE TABLE */
export async function paginateTableQuery(api: APIClient, query: any, callback: Function) {
    let more = true
    while (more) {
        try {
            const response = await api.v1.chain.get_table_rows(query);
            more = response.more
            query.lower_bound = response.next_key
            for (let i = 0; i < response.rows.length; i++) {
                const row = response.rows[i]
                const callbackReturn = callback(row)
                if (callbackReturn instanceof Promise) {
                    await callbackReturn
                }
            }
        } catch (e: any) {
            logger.error(`Failed during table pagination ${e.message}`)
            throw e
        }
    }
}


export const getTableLastBlock = async (table: string, indexer: Indexer) => {
    try {
        const row = await indexer.dbPool?.maybeOne(
            sql`SELECT MAX(block) as block
                from ${table}`
        );
        if (row) {
            return row.block as number
        }
    } catch (e) {
        logger.error(`Could not retreive last block saved to table ${table}: ${e}`)
    }
    return 0;
}

/* BLOCKS */
export const getBlockISO = async (block: number, indexer: Indexer) => {
    const blockResponse = await indexer.antelopeCore.v1.chain.get_block(block);
    return new Date(blockResponse.timestamp.toMilliseconds()).toISOString();
}

/* MISC */
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export const paginationQueryParams = Type.Object({
    limit: Type.Optional(Type.Number({
        description: 'Maximum number of results to retreive (max: 500)',
        default: 100,
        maximum: 500
    })),
    offset: Type.Optional(Type.Number({
        description: 'Offsets results for pagination (skips first X)',
        default: 0
    }))
})
