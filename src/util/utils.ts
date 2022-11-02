import {RetryFetchOpts} from "../types/configs";
import {RequestInit} from "node-fetch";
import {APIClient} from "@greymass/eosio";

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
        const response = await api.v1.chain.get_table_rows(query);
        more = response.more
        query.lower_bound = response.next_key
        for (const row of response.rows) {
            const callbackReturn = callback(row)
            if (callbackReturn instanceof Promise) {
                await callbackReturn
            }
        }
    }
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
