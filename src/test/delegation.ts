import {
    sql,
    type DatabaseConnection
} from 'slonik';
import { createDbPool } from '../util/database'
var expect = require('chai').expect;
import { deleteOrDecrementDelegation, insertOrIncrementDelegation } from '../indexer/jobs/token/TelosHandler';
import { Token } from "../types/tokens";
import Indexer from '../indexer/Indexer';
import {IndexerConfig} from "../types/configs";
const config: IndexerConfig = require("../../config.json") as IndexerConfig;

const token: Token = {id: 'eosio.token:TLOS', name: 'Telos', symbol: 'TLOS', account: 'eosio.token', logo_sm: '', logo_lg: ''}
let indexer: Indexer;
const account = 'crashtestdum';

describe('Delegation', async function() {
    before(async function() {
        indexer = await Indexer.create(config);
        indexer.dbPool = await createDbPool(config);
    })
    beforeEach(async function() {
        await indexer.dbPool?.query(sql`DELETE FROM delegations`)
        await indexer.dbPool?.query(sql`INSERT INTO delegations (from_account, to_account, cpu, net, block) VALUES (${account}, ${account}, '1000', '1000', 1) ON CONFLICT DO NOTHING`)
    })

    it('should insert delegation', async function() {
        await insertOrIncrementDelegation(token, indexer, 'crashtestdu2', 'crashtestdu2', '0.2', '0.2', 2);
        const result = await indexer.dbPool?.maybeOne(sql`SELECT * FROM delegations WHERE delegator = 'crashtestdu2' AND delegatee='crashtestdu2'`);
        expect(result).to.not.be.null;
        expect(result).to.have.property('cpu', '200');
        expect(result).to.have.property('net', '200');
    })

    it('should increment delegation', async function() {
        await insertOrIncrementDelegation(token, indexer, 'crashtestdum', 'crashtestdum', '0.2', '0.2', 2);
        const result = await indexer.dbPool?.maybeOne(sql`SELECT * FROM delegations WHERE delegator = ${account} AND delegatee=${account}`);
        expect(result).to.not.be.null;
        expect(result).to.have.property('cpu', '800');
        expect(result).to.have.property('net', '800');
    })

    it('should delete delegation', async function() {
        await deleteOrDecrementDelegation(token, indexer, 'crashtestdum', 'crashtestdum', '1', '1', 2);
        const result = await indexer.dbPool?.maybeOne(sql`SELECT * FROM delegations WHERE delegator = ${account} AND delegatee=${account}`);
        expect(result).to.be.null;
    })
    it('should decrement delegation', async function() {
        await deleteOrDecrementDelegation(token, indexer, 'crashtestdum', 'crashtestdum', '0.2', '0.2', 2);
        const result = await indexer.dbPool?.maybeOne(sql`SELECT * FROM delegations WHERE delegator = ${account} AND delegatee=${account}`);
        expect(result).to.not.be.null;
        expect(result).to.have.property('cpu', '800');
        expect(result).to.have.property('net', '800');
    })
})

