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
import {paginateTableQuery, getActions, getLastActionBlockISO} from "../../../util/utils";

const logger = createLogger('VoterPoller', 'indexer');

export const POLLER_ID: string = 'voter';

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
interface Voter {
    account: String
    vote_weight: String
}

export default class VoterPoller {

    private indexer: Indexer
    private chainApi: ChainAPI
    private lastVoterTime: number;
    private lastBpTime: number;
    private delay: number;
    private voters: Voter[];

    constructor(indexer: Indexer) {
        this.indexer = indexer
        this.chainApi = this.indexer.antelopeCore.v1.chain
        this.lastVoterTime = 0;
        this.lastBpTime = 0;
        this.delay = 1;
        this.voters = [];
    }

    async run() {

        await this.setLastBpTime()
        await this.setLastVoterTime()

        let now = new Date();
        if ((this.lastBpTime + (this.indexer.config.bpPollInterval * 60 * 1000)) < now.getTime()) {
            await this.doBps()
        }


        now = new Date();
        if ((this.lastVoterTime + (this.indexer.config.voterPollInterval * 60 * 1000) + this.delay) < now.getTime()) {
            this.delay = (this.delay === 1) ? 12000 : 0;
            await this.doVoters();
        }
    }

    private async setLastBpTime() {
        if (this.lastBpTime !== 0) {
            return;
        }

        const snapshotResult = await this.indexer.dbPool?.maybeOne(sql`SELECT MAX(date) FROM producer_snapshot`)
        if (!snapshotResult || ! snapshotResult.max) {
            return;
        }

        this.lastBpTime = Number(snapshotResult.max)
    }

    private async setLastVoterTime() {
        if (this.lastVoterTime !== 0) {
            return;
        }

        const voterResult = await this.getLastSavedBlock()

        if (!voterResult) {
            return;
        }

        await this.setLastVoterTimeFromBlock(Number(voterResult))
    }

    private async setLastVoterTimeFromBlock(block: number) {
        const getBlockResponse = await this.chainApi.get_block(block)
        this.lastVoterTime = getBlockResponse.timestamp.toMilliseconds()
    }

    private async doVoters() {
        if (this.lastVoterTime === 0) {
            await this.doVoterFullLoad();
        } else {
            await this.doVoterIncremental();
        }
    }

    private async getLastSavedBlock(): Promise<number> {
        const response = await this.indexer.dbPool?.maybeOne(sql`SELECT MAX(last_block) as block FROM voters`);
        return (response && response.block != null) ? Number(response.block) : 0;
    }

    private async insertVoter(data: any, block: number){
        const hasProducers = (data.producers && data.producers.length > 0);
        const account: string = data.owner;
        try {
            if (hasProducers) {
                const producers = sql.array(data.producers, 'text');
                const lastVoteWeight: string = data.last_vote_weight ? data.last_vote_weight.split('.')[0] : "0";
                const query = sql`
                            INSERT INTO voters (voter, last_block, producers, vote_weight)
                            VALUES (${account}, ${block}, ${producers}, ${lastVoteWeight})
                            ON CONFLICT ON CONSTRAINT voter_pkey
                                DO UPDATE
                                SET last_block  = ${block},
                                    vote_weight = ${lastVoteWeight},
                                    producers   = ${producers}`;
                const response = await this.indexer.dbPool?.query(query);
                logger.debug(`Added voter: ${account}`);
                return response;
            } else {
                const response = await this.indexer.dbPool?.maybeOne(sql`DELETE FROM voters WHERE voter = ${account}`);
                logger.debug(`Deleted voter: ${account}`);
                return response;
            }
        } catch (e) {
            logger.error(`Failed to add/delete voter: ${e}`);
        }
    }

    private async doVoterFullLoad() {
        logger.info(`Starting full load of voters...`);

        let count = 0;
        const getInfo = await this.chainApi.get_info();
        const currentLibBlock = await getInfo.last_irreversible_block_num.toNumber();

        try {
            await paginateTableQuery(this.indexer.antelopeCore, {
                code: 'eosio',
                scope: 'eosio',
                table: 'voters',
                limit: 2000,
                //type: VoterInfo
            }, async (row: any) => {
                this.insertVoter(row, currentLibBlock);
                if (++count % 1000 === 0)
                    logger.info(`Processed ${count} voters, current account: ${row.owner}`)
            })

            await this.indexer.dbPool?.query(sql`DELETE FROM voters WHERE last_block != ${currentLibBlock}`)
        } catch (e) {
            logger.error(`Failure doing voters table query: ${e}`)
        }

        this.setLastVoterTimeFromBlock(currentLibBlock)
        logger.info(`Done with full load of voters`)
    }
    private async getVoterWeight(voter: string) {
        // Check the cache first as it contains latest weight and is destroyed at each poll
        for(const sVoter of this.voters){
            if(sVoter.account === voter ){
                logger.info(`Last vote weight for ${voter} retrieved from cache: ${sVoter.vote_weight}`);
                return sVoter.vote_weight;
            }
        }

        try {
            const response = await this.indexer.antelopeCore.v1.chain.get_table_rows({
                json: true,
                code: 'eosio',
                scope: 'eosio',
                table: 'voters',
                limit: 1,
                index_position: 'primary',
                lower_bound: Name.from(voter)
            });
            if(response.rows && response.rows.length > 0){
                const weight = response.rows[0].last_vote_weight?.split('.')[0] || "0";
                logger.info(`Retrieved last vote weight for ${voter}: ${weight}`);
                this.voters.push({
                    vote_weight: weight,
                    account: voter
                });
                return weight;
            }
            logger.error(`Could not retrieve last vote weight for ${voter} : voter not found`)
        } catch (e) {
            logger.error(`Could not retrieve last vote weight for ${voter} : ${e}`)
        }
        return "0";
    }

    // Uses hyperion to get the actions that affect a voter's producers and/or vote weight and applies relevant change to the indexer database
    //
    // > We do not use wildcard for action filter because eosio has a lot of actions, including the onblock action (once per block), instead we make 3 separate hyperion queries
    // > We limit results in case we are far from synced
    private async doVoterIncremental() {

        logger.info(`Starting incremental load of voters`);
        const lastBlock = await this.getLastSavedBlock();
        if(lastBlock === 0){
            logger.debug('No last block found on table for voters, skipping incremental loads until we find one...')
            return; // Initial full load not done yet, we stop here.
        }
        const getInfo = await this.chainApi.get_info()
        const currentLibBlock = getInfo.last_irreversible_block_num.toNumber();

        // We get last block saved for each action (or last voter table block if not set yet) so that if the limit we set makes one action way ahead of others (ie: one had lots of calls, the other only a few) we can still recover after crash
        const startISOProducer = await getLastActionBlockISO('eosio:voteproducer', POLLER_ID, this.indexer, this.chainApi, lastBlock, 1)
        const startISOBuy = await getLastActionBlockISO('eosio:buyrex', POLLER_ID, this.indexer, this.chainApi, lastBlock, 1)
        const startISOSell = await getLastActionBlockISO('eosio:sellrex', POLLER_ID, this.indexer, this.chainApi, lastBlock, 1);
        const endBlockResponse = await this.chainApi.get_block(currentLibBlock)
        const endISO = new Date(endBlockResponse.timestamp.toMilliseconds()).toISOString();

        logger.info(`Querying hyperion actions for voteproducer between ${startISOProducer.toString()} & ${endISO.toString()}`)
        await getActions(this.indexer, POLLER_ID, {
            after: startISOProducer,
            before: endISO,
            sort: 'asc',
            filter: 'eosio:voteproducer',
            simple: true,
            limit: this.indexer.config.hyperionIncrementLimit,
        }, currentLibBlock, async (action: any) => {
            const data = action.data;
            data.last_vote_weight = await this.getVoterWeight(data.voter);
            data.owner = data.voter;
            await this.insertVoter(data, action.block);
        })
        await this.handleStakeAction('eosio:buyrex', startISOBuy, endISO, currentLibBlock);
        await this.handleStakeAction('eosio:sellrex', startISOSell, endISO, currentLibBlock);
        this.voters = []; // Clear cache of voters
        logger.info(`Done with one incremental load of voters`);
        this.setLastVoterTimeFromBlock(currentLibBlock);
    }

    private async handleStakeAction(actionName: string, startISO: string, endISO: string, currentBlock: number) {
        logger.info(`Querying hyperion actions for ${actionName} between ${startISO.toString()} & ${endISO.toString()}`)
        await getActions(this.indexer, POLLER_ID, {
            after: startISO,
            before: endISO,
            sort: 'asc',
            filter: actionName,
            simple: true,
            limit: this.indexer.config.hyperionIncrementLimit,
        }, currentBlock, async (action: any) => {;
            let data = action.data;
            logger.debug(`Retreived one ${actionName} action from ${data.from} at block ${action.block}`);
            data.last_vote_weight = await this.getVoterWeight(data.from);
            try {
                // We just let it fail if the voter does not exist (voter existence depends on producers selection, if he doesn't exist then no producers were selected)
                await this.indexer.dbPool?.query(sql`UPDATE voters SET last_block = ${action.block || 0}, vote_weight = ${data.last_vote_weight} WHERE voter = ${data.from}`);
            } catch (e) {
                logger.error(`Failure updating voters table: ${e}`)
            }
        })
    }
    private async doBps() {
        logger.info(`Doing BP snapshot...`)
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
        try {
            await this.indexer.dbPool?.query(sql`INSERT INTO producer_snapshot (date, snapshot) VALUES (now(), ${JSON.stringify(producerMap)})`);
            logger.debug(`Inserted new producer snapshot`)
        } catch (e) {
            logger.error(`Error inserting into producer_snapshot table: ${e}`)
        }
        logger.info(`BP snapshot complete`)
        this.lastBpTime = new Date().getTime();
    }
}
