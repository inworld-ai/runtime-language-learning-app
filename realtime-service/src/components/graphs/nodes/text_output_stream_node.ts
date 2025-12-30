import { CustomNode, ProcessContext } from '@inworld/runtime/graph';

import { ConnectionsMap, State, TextInput } from '../../../types/index';
import {TextStream} from "@inworld/runtime";

/**
 * TextInputNode updates the state with the user's input this turn.
 *
 * This node:
 * - Takes input from Text Chunking Node as a text stream
 * - Outputs for graph handler to send to the client. Only used when modality is TextOnly
 */
export class TextOutputStreamNode extends CustomNode {
    private connections: ConnectionsMap;

    constructor(props: {
        id: string;
        connections: ConnectionsMap;
    }) {
        super({
            id: props.id,
        });
        this.connections = props.connections;
    }

    process(context: ProcessContext, input: TextStream): TextStream {
        return input;
    }
}
