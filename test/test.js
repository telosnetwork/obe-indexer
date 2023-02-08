import {
    sql,
    type DatabaseConnection
} from 'slonik';
var expect = require('chai').expect;

describe('TokenHandler', function() {

    // add a test hook
    beforeEach(function() {
        // ...some logic before each test is run

    })

    // test a functionality
    it('should add increment or insert delegation', function() {
        // add an assertion
        expect(sum(1, 2, 3, 4, 5)).to.equal(15);
    })

    // test a functionality
    it('should add decrement or delete delegation', function() {
        // add an assertion
        expect(sum(1, 2, 3, 4, 5)).to.equal(15);
    })

})