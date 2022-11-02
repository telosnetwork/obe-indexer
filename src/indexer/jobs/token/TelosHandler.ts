import {Asset, Name, Struct} from "@greymass/eosio";
import Indexer from "../../Indexer";
import {paginateTableQuery} from "../../../util/utils";

@Struct.type('rexbal')
export class RexbalRow extends Struct {
    @Struct.field(Name) owner!: Name
    @Struct.field(Asset) rex_balance!: Asset
}

export const updateRexBalances = async (indexer: Indexer) => {
    await paginateTableQuery(indexer.antelopeCore, {
        code: 'eosio',
        scope: 'eosio',
        table: 'rexbal',
        type: RexbalRow
    }, (row: any) => {
        console.log(`foobar`)
    })
}
