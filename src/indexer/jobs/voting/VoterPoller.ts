import Indexer from "../../Indexer";
import {
    Asset,
    BlockTimestamp,
    ChainAPI,
    Float64,
    Int64,
    Name,
    PublicKey,
    Struct,
    TimePoint,
    UInt16,
    UInt32
} from "@greymass/eosio";
import {sql} from "slonik";
import {createLogger} from "../../../util/logger";
import {paginateTableQuery} from "../../../util/utils";
import BN from "bn.js";

// Do bp snapshot every 12hrs
const BP_INTERVAL_MS: number = 60 * 60 * 12 * 1000;

// Check for vote changes every 2min (right now we're doing this every 6hrs until the incremental vote checker is implemented)
//const VOTER_INTERVAL_MS: number = 60 * 2 * 1000;
// TODO: Make this a smaller number
const VOTER_INTERVAL_MS: number = 60 * 60 * 6 * 1000;

const logger = createLogger('VoterPoller')

@Struct.type('voter_info')
export class VoterInfo extends Struct {
    @Struct.field(Name) owner!: Name
    @Struct.field(Name) proxy!: Name
    @Struct.field(Name, {array: true}) producers!: Name[]
    @Struct.field(Int64) staked!: Int64
    @Struct.field(Int64) last_stake!: Int64
    @Struct.field(Float64) last_vote_weight!: Float64
    @Struct.field(Float64) proxied_vote_weight!: Float64
    @Struct.field('bool') is_proxy!: boolean
    @Struct.field(UInt32) flags1!: UInt32
    @Struct.field(UInt32) reserved2!: UInt32
    @Struct.field(Asset) reserved3!: Asset
}

@Struct.type('producer_info')
export class ProducerInfo extends Struct {
    @Struct.field(Name) owner!: Name
    @Struct.field(Float64) total_votes!: Float64
    @Struct.field(PublicKey) producer_key!: PublicKey
    @Struct.field('bool') is_active!: boolean
    @Struct.field('string') unreg_reason!: string
    @Struct.field('string') url!: string
    @Struct.field(UInt32) unpaid_blocks!: UInt32
    @Struct.field(UInt32) lifetime_produced_blocks!: UInt32
    @Struct.field(UInt32) missed_blocks_per_rotation!: UInt32
    @Struct.field(UInt32) lifetime_missed_blocks!: UInt32
    @Struct.field(TimePoint) last_claim_time!: TimePoint
    @Struct.field(UInt16) location!: UInt16
    @Struct.field(UInt32) kick_reason_id!: UInt32
    @Struct.field('string') kick_reason!: string
    @Struct.field(UInt32) times_kicked!: UInt32
    @Struct.field(UInt32) kick_penalty_hours!: UInt32
    @Struct.field(BlockTimestamp) last_time_kicked!: BlockTimestamp
}

interface Producer {
    account: String
    active: boolean
    totalVotes: number
    rank: number
}

export default class VotePoller {

    private indexer: Indexer
    private chainApi: ChainAPI
    private lastVoterTime: number;
    private lastBpTime: number;

    constructor(indexer: Indexer) {
        this.indexer = indexer
        this.chainApi = this.indexer.antelopeCore.v1.chain
        this.lastVoterTime = 0;
        this.lastBpTime = 0;
    }

    async run() {
        await this.setLastBpTime()
        await this.setLastVoterTime()

        let now = new Date();
        if ((this.lastBpTime + BP_INTERVAL_MS) < now.getTime()) {
            await this.doBps()
        }


        now = new Date();
        if ((this.lastVoterTime + VOTER_INTERVAL_MS) < now.getTime()) {
            await this.doVoters()
        }
    }

    private async setLastBpTime() {
        if (this.lastBpTime !== 0) {
            return;
        }

        const snapshotResult = await this.indexer.dbPool?.maybeOne(sql`SELECT MAX(date)
                                                                 FROM producer_snapshot`)
        if (!snapshotResult || ! snapshotResult.max) {
            return;
        }

        // TODO: set this properly once we have data
        this.lastBpTime = Number(snapshotResult.max)
    }

    private async setLastVoterTime() {
        if (this.lastVoterTime !== 0) {
            return;
        }

        const voterResult = await this.indexer.dbPool?.maybeOne(sql`SELECT MAX(last_block)
                                                              FROM voters`)

        if (!voterResult || !voterResult.max) {
            return;
        }

        await this.setLastVoterTimeFromBlock(Number(voterResult.max))
    }

    private async setLastVoterTimeFromBlock(block: number) {
        const getBlockResponse = await this.chainApi.get_block(block)
        this.lastVoterTime = getBlockResponse.timestamp.toMilliseconds()
    }

    private async doVoters() {
        if (this.lastVoterTime === 0) {
            await this.doVoterFullLoad()
        } else {
            await this.doVoterIncremental();
        }
    }

    private async doVoterFullLoad() {
        logger.info(`Starting full load of voters`)

        let count = 0
        const getInfo = await this.chainApi.get_info()
        const currentLibBlock = getInfo.last_irreversible_block_num.toNumber()

        try {
            await paginateTableQuery(this.indexer.antelopeCore, {
                code: 'eosio',
                scope: 'eosio',
                table: 'voters',
                limit: 2000,
                //type: VoterInfo
            }, async (row: any) => {
                const account: string = row.owner
                const hasProducers = row.producers.length > 0
                const producers = sql.array(row.producers, 'text')
                const lastVoteWeight: string = row.last_vote_weight ? row.last_vote_weight.split('.')[0] : 0
                if (hasProducers) {
                    const query = sql`
                        INSERT INTO voters (voter, last_block, producers, vote_weight)
                        VALUES (${account}, ${currentLibBlock}, ${producers}, ${lastVoteWeight})
                        ON CONFLICT ON CONSTRAINT voter_pkey
                            DO UPDATE
                            SET last_block  = ${currentLibBlock},
                                vote_weight = ${lastVoteWeight},
                                producers   = ${producers}`
                    const updated = await this.indexer.dbPool?.query(query)
                } else {
                    const deleted = await this.indexer.dbPool?.maybeOne(sql`DELETE FROM voters WHERE voter = ${account}`)
                }
                if (++count % 1000 === 0)
                    logger.info(`Processed ${count} voters, current account: ${account}`)
            })

            await this.indexer.dbPool?.query(sql`DELETE FROM voters WHERE last_block != ${currentLibBlock}`)
        } catch (e) {
            logger.error(`Failure doing voters table query: ${e}`)
        }

        this.setLastVoterTimeFromBlock(currentLibBlock)
    }

    private async doVoterIncremental() {
        // TODO: implement this and change the frequency to be much more frequent
        await this.doVoterFullLoad()
        //this.setLastVoterTimeFromBlock(currentLibBlock)
    }

    private async doBps() {
        const producers: Producer[] = []
        try {
            await paginateTableQuery(this.indexer.antelopeCore, {
                code: 'eosio',
                scope: 'eosio',
                table: 'producers',
                limit: 1000,
                type: ProducerInfo
            }, async (row: any) => {
                const rank = -1
                const account = row.owner.toString()
                const totalVotes = row.total_votes.value
                const active = row.is_active
                producers.push({account, totalVotes, active, rank})
            })
        } catch (e) {
            logger.error(`Failure doing producers table query: ${e}`)
        }

        producers.sort((a: Producer, b: Producer) => {
            if (a.totalVotes > b.totalVotes) {
                return -1
            }

            return 1
        })

        let rank = 1
        for (let i = 0; i < producers.length; i++) {
            const producer = producers[i]
            if (producer.active) {
                producer.rank = rank++;
            }
        }
        const producerMap: {[index: string]: Producer} = {}
        producers.forEach((p: Producer) => {
            producerMap[p.account.toString()] = p
        })
        await this.indexer.dbPool?.query(sql`INSERT INTO producer_snapshot (date, snapshot) VALUES (now(), ${JSON.stringify(producerMap)})`)
    }
}
