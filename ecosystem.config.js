const apps = []
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

apps.push({
    name: `${config.networkName}-obe-indexer`,
    script: "./dist/indexer.js"
},{
    name: `${config.networkName}-obe-api`,
    instances: config.apiInstances || 1,
    script: "./dist/api.js"
})

module.exports = { apps }
