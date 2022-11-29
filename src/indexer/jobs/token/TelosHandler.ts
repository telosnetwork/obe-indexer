import {Asset, Int64, Name, Struct, TimePointSec, UInt64, UInt8} from "@greymass/eosio";
import Indexer from "../../Indexer";
import {paginateTableQuery} from "../../../util/utils";
import {sql} from "slonik";
import {Token} from "../../../types/tokens";
import bigDecimal from "js-big-decimal";
import {createLogger} from "../../../util/logger";

const logger = createLogger('util')

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

export const updateDelegated = async (token: Token, currentBlock: number, indexer: Indexer) => {
    let more = true
    let nextKey = ''
    let count = 0
    let delegators: Name[] = []

    while (more) {
        const response = await indexer.antelopeCore.v1.chain.get_table_by_scope({
            code: 'eosio',
            table: 'delband',
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
        delegators = delegators.concat(
            response.rows.map((r) => Name.from(r.scope))
        )
        logger.info(`Found ${count} scopes for delegated bandwith`)
    }

    logger.info(
        `Loading rows for ${count} total delband scopes`
    )

    for (const delegator of delegators) {
        await paginateTableQuery(indexer.antelopeCore, {
            code: 'eosio',
            scope: String(delegator),
            table: 'delband',
            type: DelegatedBandwidth
        }, async (row: any) => {
            const from = row.from.toString()
            const to = row.to.toString()
            const cpuBalance = String(row.cpu_weight.units)
            const netBalance = String(row.net_weight.units)
            await indexer.dbPool?.query(sql`INSERT INTO delegations (from_account, to_account, cpu, net, block)
                                            VALUES (${from}, ${to}, ${cpuBalance}, ${netBalance}, ${currentBlock})
                                            ON CONFLICT ON CONSTRAINT delegations_pkey
                                                DO UPDATE
                                                SET cpu   = EXCLUDED.cpu,
                                                    net   = EXCLUDED.net,
                                                    block = EXCLUDED.block
            `)
            if (++count % 50 === 0)
                logger.info(`Processed ${count} delegations, current account: ${delegator}`)
        })
    }
}

export const updateRexBalances = async (token: Token, currentBlock: number, indexer: Indexer) => {
    const rexPoolResponse = await indexer.antelopeCore.v1.chain.get_table_rows({
        code: 'eosio',
        scope: 'eosio',
        table: 'rexpool',
        type: RexPool
    })

    const rexPool = rexPoolResponse.rows[0]
    const rexPrice = rexPool.total_rex.units.toString() === '0' ? new bigDecimal('0') : bigDecimal.divide(rexPool.total_lendable.units.toString(), rexPool.total_rex.units.toString(), 30)
    let count = 0
    await paginateTableQuery(indexer.antelopeCore, {
        code: 'eosio',
        scope: 'eosio',
        table: 'rexbal',
        type: RexBalance
    }, async (row: any) => {
        const rexBalance = String(row.rex_balance.units)
        const account = row.owner.toString()
        const rexStakeStr = rexBalance === '0' ? '0' : bigDecimal.floor(bigDecimal.multiply(rexBalance, rexPrice)).toString(0)
        const query = sql`
            INSERT INTO balances (block, token, account, rex_stake, total_balance, resource_stake, liquid_balance)
            VALUES (${currentBlock}, ${token.id}, ${account}, ${rexStakeStr}, ${rexStakeStr}, 0, 0)
            ON CONFLICT ON CONSTRAINT balances_pkey
                DO UPDATE
                SET rex_stake     = EXCLUDED.rex_stake,
                    total_balance = COALESCE(balances.liquid_balance, 0) + COALESCE(EXCLUDED.rex_stake, 0) +
                                    COALESCE(balances.resource_stake, 0),
                    block         = EXCLUDED.block`
        const updated = await indexer.dbPool?.query(query)
        if (++count % 50 === 0)
            logger.info(`Processed ${count} rex balances, current account: ${account}`)
    })

    await indexer.dbPool?.query(sql`UPDATE balances
                                    SET rex_stake     = 0,
                                        total_balance = COALESCE(balances.liquid_balance, 0) +
                                                        COALESCE(balances.rex_stake, 0) +
                                                        COALESCE(balances.resource_stake, 0)
                                    WHERE block != ${currentBlock}
                                      AND token = ${token.id}
    `)
}
