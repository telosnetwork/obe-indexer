import { Static, Type, TSchema } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply, paginationQueryParams } from "../../../util/utils";
import {IndexerConfig} from "../../../types/configs";
const config: IndexerConfig = require("../../../../config.json") as IndexerConfig;
import { z } from "zod";

const holdersPathParams = Type.Object({
    contract: Type.String({
        description: 'The token\'s account name'
    }),
    symbol: Type.String({
        description: 'The token\'s symbol'
    }),
})

type HoldersPathParams = Static<typeof holdersPathParams>
type PaginationQueryParams = Static<typeof paginationQueryParams>

const holdersResponseRow = Type.Object({
    account: Type.String({
        example: 'accountname',
        description: 'Account name'
    }),
    total_balance: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of total balance, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    liquid_balance: Type.Optional(Type.String({
        example: '123456789.0123456789',
        description: `(${config.baseCurrencySymbol} only) A string representation of liquid balance, possibly too large for a Number type, use a big number library to consume it as a number`
    })),
    rex_stake: Type.Optional(Type.String({
        example: '123456789.0123456789',
        description: `(${config.baseCurrencySymbol} only) A string representation of rex stake, possibly too large for a Number type, use a big number library to consume it as a number`
    })),
    resource_stake: Type.Optional(Type.String({
        example: '123456789.0123456789',
        description: `(${config.baseCurrencySymbol} only) A string representation of resource stake, possibly too large for a Number type, use a big number library to consume it as a number`
    })),
})
type HoldersResponseRow = Static<typeof holdersResponseRow>

const holdersQueryRow = z.object({
    account: z.string(),
    total_balance: z.string(),
    liquid_balance: z.optional(z.string()),
    rex_stake: z.optional(z.string()),
    resource_stake: z.optional(z.string()),
})
type HoldersQueryRow = z.infer<typeof holdersQueryRow>;


const holdersResponse = Type.Object({
    totalHolders: Type.Number({
        example: 13313,
        description: 'The total count of holders for that token'
    }),
    totalSupply: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of supply, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    holders: Type.Array(holdersResponseRow)
});

type HoldersResponse = Static<typeof holdersResponse>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: HoldersPathParams, Reply: HoldersResponse | ErrorResponseType, Querystring: PaginationQueryParams }>('/holders/:contract/:symbol', {
        schema: {
            tags: ['tokens'],
            params: holdersPathParams,
            querystring: paginationQueryParams,
            response: {
                200: holdersResponse,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        // TODO: Typecast the row results so we don't need to String(everything)
        const id = `${request.params.contract.toLowerCase()}:${request.params.symbol.toUpperCase()}`
        const limit = request.query.limit || 100;
        const offset = request.query.offset || 0;
        const token = await fastify.dbPool.maybeOne(sql`SELECT * FROM tokens WHERE id = ${id} LIMIT 1`);
        if (!token) {
            return reply.status(404).send({
                message: `Unable to find token with id ${id}`,
                details: `Please specify a valid contract and symbol`
            })
        }
        const decimals = decimalsFromSupply(String(token.supply))

        const holders = await fastify.dbPool.any(sql.type(holdersQueryRow)`SELECT total_balance, liquid_balance, rex_stake, resource_stake, account FROM balances WHERE token = ${id} ORDER BY total_balance DESC LIMIT ${limit} OFFSET ${offset}`)
        const holdersCount = await fastify.dbPool.maybeOne(sql`SELECT COUNT(*) as total FROM balances WHERE token = ${id}`)
        if (!holdersCount) {
            return reply.status(404).send({
                message: `Could not find any holders for token with id ${id}`,
                details: `Try again later or with a different token`
            })
        }
        const holdersResponse: HoldersResponse = {
            totalHolders: (holdersCount) ? holdersCount.total as number: 0,
            totalSupply: String(token.supply).split(' ')[0],
            holders: holders.map((balanceRow: HoldersQueryRow): HoldersResponseRow => {
                if(id === `${config.baseCurrencyContract}:${config.baseCurrencySymbol}`){
                    return {
                        account: balanceRow.account,
                        total_balance: balanceToDecimals(balanceRow.total_balance || '0', decimals),
                        liquid_balance: balanceToDecimals(balanceRow.liquid_balance || '0', decimals),
                        rex_stake: balanceToDecimals(balanceRow.rex_stake || '0', decimals),
                        resource_stake: balanceToDecimals(balanceRow.resource_stake || '0', decimals),
                    }
                } else {
                    return {
                        account: balanceRow.account,
                        total_balance: balanceToDecimals(balanceRow.total_balance || '0', decimals),
                    }
                }
            })
        }
        reply.status(200).send(holdersResponse);


    });
}
