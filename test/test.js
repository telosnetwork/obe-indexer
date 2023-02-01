// eslint-disable-next-line @typescript-eslint/no-var-requires,no-undef
const slonik = require('slonik');

(async () => {
    const pool = await slonik.createPool('postgresql://obe:obe@localhost:5455/obe')
    // eslint-disable-next-line no-undef
    console.log('worked');
    // eslint-disable-next-line no-undef
    console.log(pool.getPoolState())
})()
