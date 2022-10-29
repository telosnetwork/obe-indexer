export interface TokenList {
    tokens: Token[]
}

export interface Token {
    name: string,
    id: string,
    logo_sm: string,
    logo_lg: string,
    symbol: string,
    account: string
}

export interface TokenRow extends Row{
    id: string,
    last_block: bigint
}

export interface TokenListResponse {
    data: TokenList
}

@Struct.type('account')
export class AccountRow extends Struct {
    @Struct.field(Asset) balance!: Asset
}
