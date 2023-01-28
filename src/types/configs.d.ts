export interface IndexerConfig {
    apiAddress: string
    apiPort: number
    apiHost: string
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
    hyperionIncrementLimit: number
}

export interface RetryFetchOpts {
    attempts: number
    delay: number
    silent: boolean
}
