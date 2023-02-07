import {Static, Type} from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";
import {IndexerConfig} from "../../../types/configs";
const config: IndexerConfig = require("../../../../config.json") as IndexerConfig;
import { z } from "zod";

const delegationsQueryString = Type.Object({
    from: Type.Optional(Type.String({
        description: 'Account name for the account that has delegated staked resources',
    })),
    to: Type.Optional(Type.String({
        description: 'Account name for the account that has received the staked resources'
    })),
    limit: Type.Optional(Type.Number({
        description: 'Maximum number of results to retreive (max: 500)',
        default: 100,
        maximum: 500
    })),
    offset: Type.Optional(Type.Number({
        description: 'Offsets results for pagination (skips first X)',
        default: 0
    }))
})

type DelegationsQueryString = Static<typeof delegationsQueryString>

const delegationQueryRow = z.object({
    from_account: z.string(),
    to_account: z.string(),
    cpu: z.string(),
    net: z.string(),
})
type DelegationQueryRow = z.infer<typeof delegationQueryRow>;

const delegationRow = Type.Object({
    from: Type.String({
        example: 'delegatooorr',
        description: 'Account name for the account that has delegated staked resources'
    }),
    to: Type.String({
        example: 'delegateeee',
        description: 'Account name for the account that has received the staked resources'
    }),
    cpu: Type.String({
        example: '56789.0123',
        description: 'A string representation of cpu staked balance, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    net: Type.String({
        example: '56789.0123',
        description: 'A string representation of net staked balance, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
})

type DelegationRow = Static<typeof delegationRow>

const delegationsResponseSchema = Type.Object({
    delegations: Type.Array(delegationRow)
})

type DelegationsResponse = Static<typeof delegationsResponseSchema>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Querystring: DelegationsQueryString, Reply: DelegationsResponse | ErrorResponseType }>('/delegations', {
        schema: {
            tags: ['tokens'],
            querystring: delegationsQueryString,
            response: {
                200: delegationsResponseSchema,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        const limit = request.query.limit || 100;
        const offset = request.query.offset || 0;
        const from = request.query.from
        const to = request.query.to
        if (!from && !to) {
            reply.status(404).send({
                message: `Missing to or from`,
                details: `Must specify a to or a from account when querying for delegations`
            })
        }

        const components = []
        if (to) {
            components.push(sql`to_account =
            ${to}`)
        }

        if (from) {
            components.push(sql`from_account =
            ${from}`)
        }
        const query = sql.type(delegationQueryRow)`SELECT from_account, to_account, cpu, net FROM delegations WHERE ${sql.join(components, sql` AND `)} LIMIT ${limit} OFFSET ${offset}`;
        const delegationsResult = await fastify.dbPool.any(query)
        const delegationsResponse: DelegationsResponse = {
            delegations: delegationsResult.map((row: DelegationQueryRow): DelegationRow => {
                return {
                    from: row.from_account,
                    to: row.to_account,
                    cpu: balanceToDecimals(row.cpu, config.baseCurrencyDecimals),
                    net: balanceToDecimals(row.net, config.baseCurrencyDecimals)
                }
            })
        }
        reply.send(delegationsResponse)
    })
}
