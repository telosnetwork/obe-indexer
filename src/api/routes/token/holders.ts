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
    balance: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of balance, possibly too large for a Number type, use a big number library to consume it as a number'
    })
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

        const holders = await fastify.dbPool.query(sql`SELECT * FROM balances WHERE token = ${id} ORDER BY balance DESC LIMIT 500`)
        const holdersResponse: HoldersResponse = {
            totalSupply: String(token.supply),
            holders: holders.rows.map((balanceRow): HoldersRow => {
                return {
                    account: String(balanceRow.account),
                    balance: balanceToDecimals(String(balanceRow.balance), decimals)
                }
            })
        }

        reply.status(200).send(holdersResponse)
    })
}
