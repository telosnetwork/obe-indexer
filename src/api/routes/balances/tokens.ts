import { Static, Type, TSchema } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply, paginationQueryParams } from "../../../util/utils";
import {IndexerConfig} from "../../../types/configs";
const config: IndexerConfig = require("../../../../config.json") as IndexerConfig;
import { z } from "zod";

const tokensPathParams = Type.Object({
    account: Type.String({
        description: 'The account name'
    })
})

type TokensPathParams = Static<typeof tokensPathParams>
type PaginationQueryParams = Static<typeof paginationQueryParams>

const tokenRow = Type.Object({
    token_account: Type.String({
        example: config.baseCurrencyContract,
        description: 'Token account name'
    }),
    token_symbol: Type.String({
        example: config.baseCurrencySymbol,
        description: 'Token symbol'
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
type TokenRow = Static<typeof tokenRow>

const tokensQueryRow = z.object({
    account: z.string(),
    token: z.string(),
    total_balance: z.string(),
    liquid_balance: z.optional(z.string()),
    rex_stake: z.optional(z.string()),
    resource_stake: z.optional(z.string()),
})
type TokensQueryRow = z.infer<typeof tokensQueryRow>;


const tokensResponse = Type.Object({
    totalTokens: Type.Number({
        example: 1,
        description: 'The total count of different tokens for that account'
    }),
    tokens: Type.Array(tokenRow)
});

type TokensResponse = Static<typeof tokensResponse>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: TokensPathParams, Reply: TokensResponse | ErrorResponseType, Querystring: PaginationQueryParams }>('/:account', {
        schema: {
            tags: ['tokens'],
            params: tokensPathParams,
            querystring: paginationQueryParams,
            response: {
                200: tokensResponse,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        // TODO: Typecast the row results so we don't need to String(everything)
        const limit = request.query.limit || 100;
        const offset = request.query.offset || 0;
        const account = request.params.account.toLowerCase();

        const tokens = await fastify.dbPool.any(sql.type(tokensQueryRow)`SELECT token, total_balance, liquid_balance, rex_stake, resource_stake, account FROM balances WHERE account = ${account} ORDER BY total_balance DESC LIMIT ${limit} OFFSET ${offset}`);
        if(tokens.length === 0){
            reply.status(404).send({
                message: 'Unable to find any balances for that account name',
                details: 'Unable to find any balances for that account name'
            });
        }
        const tokensCount = await fastify.dbPool.maybeOne(sql`SELECT COUNT(*) as total FROM balances WHERE account = ${account}`);
        const tokensResponse: TokensResponse = {
            totalTokens: (tokensCount) ? tokensCount.total as number: 0,
            tokens: await Promise.all(tokens.map(async (balanceRow: TokensQueryRow): Promise<TokenRow> => {
                const token = await fastify.dbPool.one(sql`SELECT * FROM tokens WHERE id = ${balanceRow.token} LIMIT 1`);
                const decimals = decimalsFromSupply(String(token.supply))
                const tokenParts = balanceRow.token.split(':');
                if(balanceRow.token === `${config.baseCurrencyContract}:${config.baseCurrencySymbol}`){
                    return  {
                        token_account: tokenParts[0],
                        token_symbol: tokenParts[1],
                        total_balance: balanceToDecimals(balanceRow.total_balance || '0', decimals),
                        liquid_balance: balanceToDecimals(balanceRow.liquid_balance || '0', decimals),
                        rex_stake: balanceToDecimals(balanceRow.rex_stake || '0', decimals),
                        resource_stake: balanceToDecimals(balanceRow.resource_stake || '0', decimals),
                    }
                } else {
                    return {
                        token_account: tokenParts[0],
                        token_symbol: tokenParts[1],
                        total_balance: balanceToDecimals(balanceRow.total_balance || '0', decimals),
                    }
                }
            }))
        }
        reply.status(200).send(tokensResponse);


    });
}
