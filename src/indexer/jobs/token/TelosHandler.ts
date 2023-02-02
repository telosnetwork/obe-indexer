import {Asset, ChainAPI, Int64, Name, Struct, TimePointSec, UInt64, UInt8} from "@greymass/eosio";
import Indexer from "../../Indexer";
import {paginateTableQuery, getActions, getLastActionBlockISO, setLastActionBlock } from "../../../util/utils";
import {sql} from "slonik";
import {Token} from "../../../types/tokens";
import bigDecimal from "js-big-decimal";
import {createLogger} from "../../../util/logger";
import {getBlockISO} from "../../../util/utils";

const logger = createLogger('TelosHandler', 'indexer')

@Struct.type('pair_time_point_sec_int64')
export class PairTimePointSecInt64 extends Struct {
    @Struct.field(TimePointSec) first!: TimePointSec;
    @Struct.field(Int64) second!: Int64;
}

@Struct.type('rex_balance')
export class RexBalance extends Struct {
    @Struct.field(UInt8) version!: UInt8;
    @Struct.field(Name) owner!: Name;
    @Struct.field(Asset) vote_stake!: Asset;
    @Struct.field(Asset) rex_balance!: Asset;
    @Struct.field(Int64) matured_rex!: Int64;
    @Struct.field(PairTimePointSecInt64, {array: true}) rex_maturities!: PairTimePointSecInt64[];
}

@Struct.type('rex_pool')
export class RexPool extends Struct {
    @Struct.field(UInt8) version!: UInt8
    @Struct.field(Asset) total_lent!: Asset
    @Struct.field(Asset) total_unlent!: Asset
    @Struct.field(Asset) total_rent!: Asset
    @Struct.field(Asset) total_lendable!: Asset
    @Struct.field(Asset) total_rex!: Asset;
    @Struct.field(Asset) namebid_proceeds!: Asset
    @Struct.field(UInt64) loan_num!: UInt64
}

@Struct.type('delegated_bandwidth')
export class DelegatedBandwidth extends Struct {
    @Struct.field(Name) from!: Name
    @Struct.field(Name) to!: Name
    @Struct.field(Asset) net_weight!: Asset
    @Struct.field(Asset) cpu_weight!: Asset
}

/*
 * UTILS
 *
 */
const getStakedDelegationBalance = async (delegator: Name, indexer: Indexer) => {
    const sumQuery = sql`SELECT SUM(net) + SUM(cpu) AS sum
                         FROM delegations
                         WHERE from_account = ${String(delegator)}`;
    const stakedSum = await indexer.dbPool?.one(sumQuery);
    return stakedSum && stakedSum.sum ? stakedSum.sum as string : '0';
}

export const getTokenBalanceLastBlock = async (token: Token, indexer: Indexer) => {
    try {
        const row = await indexer.dbPool?.maybeOne(
            sql`SELECT MAX(block) as block
                from balances
                where token = ${token.id}`
        );
        if (row) {
            return row.block as number;
        }
    } catch (e) {
        logger.error(`Could not retreive last block saved to table balances for ${token.name} (${token.symbol}): ${e}`);
    }
    return 0;
}
const getRexPrice = async (indexer: Indexer) => {
    try {
        const rexPoolResponse = await indexer.antelopeCore.v1.chain.get_table_rows({
            code: 'eosio',
            scope: 'eosio',
            table: 'rexpool',
            type: RexPool
        })
        const rexPool = rexPoolResponse.rows[0];
        return rexPool.total_rex.units.toString() === '0' ? new bigDecimal('0') : bigDecimal.divide(rexPool.total_lendable.units.toString(), rexPool.total_rex.units.toString(), 30);
    } catch (e) {
        logger.error(`Could not retreive rex price: ${e}`)
        return new bigDecimal('0');
    }
}

/*
 * DELEGATIONS
 *
 */
export const loadDelegatedIncremental = async (token: Token, currentBlock: number, lastBlock: number, poller: string, indexer: Indexer, chainApi: ChainAPI) => {
    const startDelegateISO = await getLastActionBlockISO('eosio:delegatebw', poller, indexer, chainApi, lastBlock, 1);
    const startUndelegateISO = await getLastActionBlockISO('eosio:undelegatebw', poller, indexer, chainApi, lastBlock, 1);
    const endISO = await getBlockISO(currentBlock, indexer);
    await handleDelegationAction('eosio:delegatebw', token, startDelegateISO, endISO, currentBlock, poller, indexer)
    await handleDelegationAction('eosio:undelegatebw', token, startUndelegateISO, endISO, currentBlock, poller, indexer)
}

export const loadDelegated = async (token: Token, currentBlock: number, indexer: Indexer) => {
    let more = true;
    let nextKey = '';
    let count = 0, index = 0;
    let delegators: Name[] = [];

    while (more) {
        const response = await indexer.antelopeCore.v1.chain.get_table_by_scope({
            code: 'eosio',
            table: 'delband',
            lower_bound: nextKey,
            limit: 500,
        })

        if (response.more && response.more !== '') {
            more = true;
            nextKey = response.more;
        } else {
            more = false;
        }
        count += response.rows.length;
        delegators = delegators.concat(
            response.rows.map((r) => Name.from(r.scope))
        );
        logger.info(`Found ${count} scopes for delegated bandwith`);
    }

    logger.info( `Loading rows for ${count} total delband scopes` );

    count = 0;
    for (const delegator of delegators) {
        await paginateTableQuery(indexer.antelopeCore, {
            code: 'eosio',
            // TOOD: once there's a better way to handle accounts like '1' besides adding the space as below, fix this and don't have the space
            scope: `${String(delegator)} `,
            table: 'delband',
            type: DelegatedBandwidth
        }, async (row: any) => {
            const from = row.from.toString();
            const to = row.to.toString();
            const cpuBalance = String(row.cpu_weight.units);
            const netBalance = String(row.net_weight.units);
            await indexer.dbPool?.query(sql`INSERT INTO delegations (from_account, to_account, cpu, net, block)
                                            VALUES (${from}, ${to}, ${cpuBalance}, ${netBalance}, ${currentBlock})
                                            ON CONFLICT ON CONSTRAINT delegations_pkey
                                                DO UPDATE
                                                SET cpu   = EXCLUDED.cpu,
                                                    net   = EXCLUDED.net,
                                                    block = EXCLUDED.block
                                                 WHERE delegations.from_account = ${String(from)} AND delegations.to_account = ${to}
            `);
            if (++count % 50 === 0)
                logger.info(`Processed ${count} delegations, current delegator: ${delegator} (${index} of ${delegators.length} delagators)`);
        });
        index++;
    }

    await indexer.dbPool?.query(sql`DELETE FROM delegations WHERE block != ${currentBlock} `);

    for (const delegator of delegators) {
        await updateRexBalancesFromDelegation(token, indexer, delegator, currentBlock);
    }
}
const handleDelegationAction = async (actionName: any, token: Token, startISO: string, endISO: string, currentBlock: number, poller: string, indexer: Indexer) => {
    logger.debug(`Handling ${actionName} action`);
    try {
        await getActions(indexer, poller, {
            after: startISO,
            before: endISO,
            sort: 'asc',
            filter: actionName,
            simple: true,
            limit: indexer.config.hyperionIncrementLimit,
        }, currentBlock, async (index: number, action: any) => {
            const data = action.data;
            const from = action.data.from.toString();
            const to = action.data.receiver.toString();

            if(action.name === "eosio:delegatebw"){
                insertOrIncrementDelegation(token, indexer, from, to, String(action.data.stake_cpu_quantity), String(action.data.stake_net_quantity), action.block);
            } else {
                deleteOrDecrementDelegation(token, indexer, from, to, String(action.data.unstake_cpu_quantity), String(action.data.unstake_net_quantity), action.block);
            }
        })
    } catch (e) {
        logger.error(`Could not retreive action ${actionName}: ${e}`);
    }

}
const deleteOrDecrementDelegation = async (token: Token, indexer: Indexer, from: string, to: string, cpuAmount: string, netAmount: string, block: number) => {
    try {
        const row = await indexer.dbPool?.maybeOne(sql`SELECT cpu, net FROM delegations WHERE from_account = ${from} AND to_account = ${to}`);
        if(!row) return; // Nothing to decrement
        const newNetBalance = bigDecimal.subtract(row.net, netAmount).toString();
        const newCPUBalance = bigDecimal.subtract(row.cpu, cpuAmount).toString();
        logger.debug(`delegation from ${from} to ${to} => new cpu: ${newCPUBalance}, new net: ${newNetBalance}`);
        if(bigDecimal.compareTo(newNetBalance, 0) !== 0 && bigDecimal.compareTo(newCPUBalance, 0) !== 0){
            logger.debug(`Deleting delegation from ${from} to ${to}`);
            await indexer.dbPool?.query(sql`DELETE FROM delegations WHERE from_account = ${from} AND to_account = ${to}`);
        } else {
            logger.debug(`Decrementing delegation from ${from} to ${to} => new cpu: ${newCPUBalance}, new net: ${newNetBalance}`);
            await indexer.dbPool?.query(sql`UPDATE delegations
                SET cpu   = ${newCPUBalance},
                    net   = ${newNetBalance},
                    block = ${block}
                WHERE from_account = ${from} AND to_account = ${to}
            `);
        }
        await updateRexBalancesFromDelegation(token, indexer,  Name.from(from), block);
    } catch (e) {
        logger.error(`Could not decrement or delete delegation from ${from} to ${to}: ${e} `);
    }
}
const insertOrIncrementDelegation = async (token: Token,indexer: Indexer, from: string, to: string, cpuAmount: string, netAmount: string, block: number) => {
    try {
        await indexer.dbPool?.query(sql`INSERT INTO delegations (from_account, to_account, cpu, net, block)
                VALUES (${from}, ${to}, ${cpuAmount}, ${netAmount}, ${block})
                ON CONFLICT ON CONSTRAINT delegations_pkey
                    DO UPDATE
                    SET cpu   = COALESCE(EXCLUDED.cpu, 0) + COALESCE(delegations.cpu, 0),
                        net   = COALESCE(EXCLUDED.net, 0) + COALESCE(delegations.net, 0),
                        block = EXCLUDED.block
                WHERE delegations.from_account = ${String(from)} AND delegations.to_account = ${to}
        `);
        await updateRexBalancesFromDelegation(token, indexer,  Name.from(from), block);
        logger.debug(`Incremented or inserted delegation from ${from} to ${to}`);
    } catch (e) {
        logger.error(`Could not increment or insert delegation, from ${from} to ${to}: ${e}`);
    }
}

/*
 * REX BALANCES
 *
 */
export const loadRexBalancesIncremental = async (token: Token, currentBlock: number, lastBlock: number, poller: string, indexer: Indexer, chainAPI: ChainAPI) => {
    const startBuyISO = await getLastActionBlockISO('eosio:buyrex', poller, indexer, chainAPI, lastBlock, 1);
    const startSellISO = await getLastActionBlockISO('eosio:sellrex', poller, indexer, chainAPI, lastBlock, 1);
    const endISO = await getBlockISO(currentBlock, indexer);
    await handleRexBalancesAction('eosio:buyrex', token, startBuyISO, endISO, currentBlock, poller, indexer);
    await handleRexBalancesAction('eosio:sellrex', token, startSellISO, endISO, currentBlock, poller, indexer);
}
export const loadRexBalances = async (token: Token, currentBlock: number, indexer: Indexer) => {
    const rexPrice = await getRexPrice(indexer);
    let count = 0;
    logger.debug(`Querying rex balances table for full load...`);
    await paginateTableQuery(indexer.antelopeCore, {
        code: 'eosio',
        scope: 'eosio',
        table: 'rexbal',
        type: RexBalance
    }, async (row: any) => {
        if (++count % 50 === 0)
            logger.info(`Processed ${(count)} rex balances, current account processing: ${row.owner.toString()}`);
        return await insertRexBalance(row, rexPrice, token, currentBlock, indexer);
    });
    try {
        logger.debug(`Setting old rex balances to 0...`);
        return await indexer.dbPool?.query(sql`
                    UPDATE balances
                    SET rex_stake     = 0,
                        total_balance = COALESCE(balances.liquid_balance, 0) +
                                        COALESCE(balances.rex_stake, 0) +
                                        COALESCE(balances.resource_stake, 0)
                    WHERE block != ${currentBlock} AND token = ${token.id}
                `);
    } catch (e) {
        logger.error(`Could not update rex balances for old blocks: ${e}`)
    }
}
const handleRexBalancesAction = async (action: any, token: Token, startISO: string, endISO: string, currentBlock: number, poller: string, indexer: Indexer) => {
    const rexPrice = await getRexPrice(indexer);
    try {
        await getActions(indexer, poller, {
            after: startISO,
            before: endISO,
            sort: 'asc',
            filter: action,
            simple: true,
            limit: indexer.config.hyperionIncrementLimit,
        }, currentBlock, async (index: number, action: any) => {
            let count = 0;
            let account = Name.from(action.data.from);
            // TOOD: once there's a better way to handle accounts like '1' besides adding the space in upper_bound & lower_bound as below, fix this and don't have the space
            await paginateTableQuery(indexer.antelopeCore, {
                code: 'eosio',
                scope: 'eosio',
                table: 'rexbal',
                type: RexBalance,
                upper_bound: Name.from(account),
                lower_bound: Name.from(account),
                limit: 1,
            }, async (row: any) => {
                insertRexBalance(row, rexPrice, token, action.block, indexer);
                count++;
            });
            if(count === 0){
                try {
                    await indexer.dbPool?.query(sql`
                        UPDATE balances
                        SET rex_stake     = 0,
                            total_balance = COALESCE(balances.liquid_balance, 0) +
                                            COALESCE(balances.rex_stake, 0) +
                                            COALESCE(balances.resource_stake, 0)
                        WHERE balances.account = ${action.data.from} AND balances.token = ${token.id}
                    `);
                } catch (e) {
                    logger.error(`Could not update rex balances for old blocks: ${e}`)
                }
            }
        })
    } catch (e) {
        logger.error(`Could not retreive action ${action.name} : ${e}`)
    }
}
export const updateRexBalancesFromDelegation = async (token: Token, indexer: Indexer, delegator: Name, block: number) => {
    logger.debug(`Updating REX balance for delegation from ${delegator}`);
    const stakedSum = await getStakedDelegationBalance(delegator, indexer);
    try {
        const query = sql`
            INSERT INTO balances (block, token, account, resource_stake, total_balance, rex_stake, liquid_balance)
            VALUES (${block}, ${token.id}, ${String(delegator)}, ${String(stakedSum)}, ${String(stakedSum)}, 0,
                    0)
            ON CONFLICT ON CONSTRAINT balances_pkey
                DO UPDATE
                SET resource_stake = EXCLUDED.resource_stake,
                    total_balance  = COALESCE(balances.liquid_balance, 0) + COALESCE(balances.rex_stake, 0) +
                                     COALESCE(EXCLUDED.resource_stake, 0),
                    block          = EXCLUDED.block
                WHERE balances.account = ${String(delegator)} AND balances.token = ${token.id}`
        return await indexer.dbPool?.query(query);
    } catch (e) {
        logger.error(`Could not update rex balance for delegation from ${String(delegator)}: ${e}`);
    }
}
export const insertRexBalance = async (row: any, rexPrice: string | bigDecimal, token: Token, currentBlock: number, indexer: Indexer) => {
    const rexBalance = String(row.rex_balance.units);
    const account = row.owner.toString();
    const rexStakeStr = rexBalance === '0' ? '0' : bigDecimal.floor(bigDecimal.multiply(rexBalance, rexPrice)).toString(0);
    try {
        const query = sql`
            INSERT INTO balances (block, token, account, rex_stake, total_balance, resource_stake, liquid_balance)
            VALUES (${currentBlock}, ${token.id}, ${String(account)}, ${rexStakeStr}, ${rexStakeStr}, 0, 0)
            ON CONFLICT ON CONSTRAINT balances_pkey
                DO UPDATE
                SET rex_stake     = EXCLUDED.rex_stake,
                    total_balance = COALESCE(balances.liquid_balance, 0) + COALESCE(EXCLUDED.rex_stake, 0) +
                                    COALESCE(balances.resource_stake, 0),
                    block         = EXCLUDED.block
                WHERE balances.account = ${String(account)} AND balances.token = ${token.id}
        `;
        return await indexer.dbPool?.query(query);
    } catch (e) {
        logger.error(`Could not insert or update rex balance for ${account} : ${e}`);
    }
    return;
}
