export interface IndexerConfig {
    mode: string
    logLevel: string
    apiVersion: string
    networkName: string
    displayNetworkName: string
    documentationUrl: string
    apiAddress: string
    apiPort: number
    apiHost: string
    baseCurrencyContract: string
    baseCurrencySymbol: string
    baseCurrencyDecimals: number
    apiProtocols: string[]
    tokenListUrl: string
    nodeosUrl: string
    hyperionUrl: string
    dbHost: string
    dbPort: number
    dbName: string
    dbUser: string
    dbPass: string
    dbMaximumPoolSize: number
    dbConnectionRetries: number
    dbConnectionTimeout: number
    fetchRetryCount: number
    fetchRetryDelay: number
    tokenListInterval: number
    tokenPollInterval: number
    rexPollInterval: number
    voterPollInterval: number
    bpPollInterval: number
}

export interface RetryFetchOpts {
    attempts: number
    delay: number
    silent: boolean
}

export interface NetworkOpts {
    networkName: string
}
