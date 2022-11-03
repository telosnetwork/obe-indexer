import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";

const holdersQueryParams = Type.Object({
    contract: Type.String(),
    symbol: Type.String()
})

type HoldersQueryParams = Static<typeof holdersQueryParams>

const holdersRow = Type.Object({
    account: Type.String({
        example: 'accountname',
        description: 'Account name'
    }),
    total_balance: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of total balance, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    liquid_balance: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of liquid balance, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    rex_stake: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of rex stake, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    resource_stake: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of resource stake, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
})

type HoldersRow = Static<typeof holdersRow>

const holdersResponseSchema = Type.Object({
    totalSupply: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of supply, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    holders: Type.Array(holdersRow)
})

type HoldersResponse = Static<typeof holdersResponseSchema>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: HoldersQueryParams, Reply: HoldersResponse | ErrorResponseType }>('/holders/:contract/:symbol', {
        schema: {
            tags: ['tokens'],
            params: holdersQueryParams,
            response: {
                200: holdersResponseSchema,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        // TODO: Typecast the row results so we don't need to String(everything)
        const id = `${request.params.contract}:${request.params.symbol}`
        const token = await fastify.dbPool.one(sql`SELECT * FROM tokens WHERE id = ${id}`)
        if (!token) {
            return reply.status(404).send({
                message: `Unable to find token with id ${id}`,
                details: `Please specify a valid contract and symbol`
            })
        }

        const decimals = decimalsFromSupply(String(token.supply))

        const holders = await fastify.dbPool.query(sql`SELECT * FROM balances WHERE token = ${id} ORDER BY total_balance DESC LIMIT 500`)
        const holdersResponse: HoldersResponse = {
            totalSupply: String(token.supply),
            holders: holders.rows.map((balanceRow): HoldersRow => {
                return {
                    account: String(balanceRow.account),
                    total_balance: balanceToDecimals(String(balanceRow.total_balance), decimals),
                    liquid_balance: balanceToDecimals(String(balanceRow.liquid_balance), decimals),
                    rex_stake: balanceToDecimals(String(balanceRow.rex_stake), decimals),
                    resource_stake: balanceToDecimals(String(balanceRow.resource_stake), decimals),

                }
            })
        }

        reply.status(200).send(holdersResponse)
    })
}
