import {RetryFetchOpts} from "../types/configs";
import {RequestInit} from "node-fetch";

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

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
