import {RetryFetchOpts} from "../types/configs";
import {RequestInit} from "node-fetch";
import {APIClient} from "@greymass/eosio";
import {createLogger} from "./logger";

const logger = createLogger('utils.ts')

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

export function decimalsFromSupply(supply: string) {
    return supply.split(' ')[0].split('.')[1].length
}

export function balanceToDecimals(balance: string, decimals: number): string {
    const len = balance.length
    if (len <= decimals)
        return `0.${balance.padStart(decimals, '0')}`

    return `${balance.substring(0, len - decimals)}.${balance.substring(len - decimals)}`
}

export async function paginateTableQuery(api: APIClient, query: any, callback: Function) {
    let more = true
    while (more) {
        let response;
        try {
            response = await api.v1.chain.get_table_rows(query);
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

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
