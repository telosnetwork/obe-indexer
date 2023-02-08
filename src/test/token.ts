import {
    sql,
    type DatabaseConnection
} from 'slonik';
import {createDbPool } from '../utils/database'
var expect = require('chai').expect;

const pool = createDbPool({
    "dbHost": "localhost",
    "dbPort": 5432,
    "dbName": "obeindex",
    "dbUser": "obe",
    "dbPass": "obe",
    "dbMaximumPoolSize": 10,
    "dbConnectionRetries": 5,
    "dbConnectionTimeout": 10000,
})


describe('Token', function() {
    beforeEach(function() {
        await pool.query(sql`DELETE FROM tokens`)
        await pool.query(sql`INSERT INTO tokens (id, last_block, supply) VALUES ('eosio.token:TLOS', 1, '10000000') ON CONFLICT DO NOTHING`)
    })

    it('should insert a new token', function() {

    })
})

