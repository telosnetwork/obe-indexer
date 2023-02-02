import {Static, Type} from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";

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

        const delegationsResult = await fastify.dbPool.query(sql`SELECT *
                                                                 FROM delegations
                                                                 WHERE ${sql.join(components, sql` AND `)} LIMIT ${limit} OFFSET ${offset}`)
        const delegationsResponse: DelegationsResponse = {
            delegations: delegationsResult.rows.map((row): DelegationRow => {
                return {
                    from: String(row.from_account),
                    to: String(row.to_account),
                    cpu: balanceToDecimals(String(row.cpu), 4),
                    net: balanceToDecimals(String(row.net), 4)
                }
            })
        }
        reply.send(delegationsResponse)
    })
}
