import { Static, Type } from '@sinclair/typebox'
import {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions} from "fastify";
import {sql} from "slonik";
import {errorResponse, ErrorResponseType} from "../../schemas/errorResponse";
import {balanceToDecimals, decimalsFromSupply} from "../../../util/utils";
import { z } from "zod";

const voterQueryParams = Type.Object({
    voter: Type.String({
        description: 'Voter account name'
    })
})

type VoterQueryParams = Static<typeof voterQueryParams>

const producerRow = Type.String({
    example: 'bestbp',
    description: 'A string representation of the producer\'s account name'
})

type ProducerRow = Static<typeof producerRow>

const voterQueryRow =  z.object({
    producers: z.array(z.string()),
    vote_weight: z.string()
});
type VoterQueryRow = z.infer<typeof voterQueryRow>

const voterResponse = Type.Object({
    vote_weight: Type.String({
        example: '123456789.0123456789',
        description: 'A string representation of vote weight, possibly too large for a Number type, use a big number library to consume it as a number'
    }),
    producers: Type.Array(producerRow),
    producerCount: Type.Number({
        example: '1',
        description: 'The count of producers this voter voted for'
    })
})

type VoterResponse = Static<typeof voterResponse>

export default async (fastify: FastifyInstance, options: FastifyServerOptions) => {
    fastify.get<{ Params: VoterQueryParams, Reply: VoterResponse | ErrorResponseType }>('/:voter', {
        schema: {
            tags: ['voters'],
            params: voterQueryParams,
            response: {
                200: voterResponse,
                404: errorResponse
            }
        }
    }, async (request, reply) => {
        const voter = await fastify.dbPool.maybeOne(sql.type(voterQueryRow)`SELECT producers, vote_weight FROM voters WHERE voter=${String(request.params.voter)} LIMIT 1`);
        if(!voter){
            return reply.code(404).send({'message': 'Voter not found', 'details' : `Voter ${request.params.voter} could not be found in the database, make sure the account name is correct` });
        }
        const producers = (voter.producers) ? JSON.parse(JSON.stringify(voter.producers)) : Array<string>();
        if(!voter.producers){
            reply.code(404).send({'message': 'Not producers found for voter', 'details' : `Not producers found for voter ${request.params.voter} in the database, make sure the account name is correct and has voted or wait for indexing` });
        }
        const voterResponse: VoterResponse = {
            producers: producers,
            producerCount: producers.length,
            vote_weight: (parseInt(voter.vote_weight) / 10000).toFixed(4)
        }

        reply.status(200).send(voterResponse)
    })
}
