/**
 * 流程图主画布：React Flow 与 EditorStore 的接线层。
 * - 节点/边从 store 派生，拖拽结束写回 moveNode。
 * - 连线通过节点把手（Handle）发起：branch 有 then/else 两个源把手，
 *   thread 有 thread 源把手，其余为普通 next。
 * - 点击节点同步 store 选中态；Backspace/Delete 删除节点（START 节点 deletable=false）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  Handle,
  Position,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  addNode,
  connectNodes,
  disconnectEdge,
  moveNode,
  selectNode,
  type DocEdge,
  type DocNode,
  type EdgeKind,
  type EditorState,
  type EditorStore,
} from '@hcb-editor/editor';
import { NodeCard } from '../components/NodeCard.js';
import { defaultNode } from '../components/defaultNode.js';
import type { CreatableNodeKind } from '../theme/meta.js';

type EditorNodeData = { readonly docNode: DocNode; readonly isStart: boolean };
type EditorNode = Node<EditorNodeData, 'editor'>;

function toNode(docNode: DocNode, selected: boolean, startNodeId: string): EditorNode {
  return {
    id: docNode.id,
    type: 'editor',
    position: { x: docNode.x, y: docNode.y },
    data: { docNode, isStart: docNode.id === startNodeId },
    selected,
    deletable: docNode.id !== startNodeId,
  };
}

function toEdge(edge: DocEdge): Edge {
  const label = edge.kind === 'next' ? undefined : edge.kind;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label,
    style: { stroke: 'var(--border-strong)', strokeWidth: 1.2 },
    labelStyle: { fill: 'var(--text-secondary)', fontSize: 10 },
    labelBgStyle: { fill: 'var(--bg-surface)' },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 3,
  };
}

function EditorFlowNode(props: NodeProps<EditorNode>) {
  const { docNode, isStart } = props.data;
  const kind = docNode.node.kind;
  return (
    <div className="flow-node">
      {!isStart && <Handle type="target" position={Position.Left} />}
      <NodeCard node={docNode} selected={props.selected ?? false} />
      {kind === 'branch' ? (
        <>
          <Handle type="source" position={Position.Right} id="then" style={{ top: '32%' }} />
          <Handle type="source" position={Position.Right} id="else" style={{ top: '68%' }} />
        </>
      ) : kind === 'thread' ? (
        <Handle type="source" position={Position.Right} id="thread" />
      ) : kind === 'jump' ? (
        <Handle type="source" position={Position.Right} id="jump" />
      ) : (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

const nodeTypes = { editor: EditorFlowNode };

export interface FlowCanvasHandle {
  readonly add: (kind: CreatableNodeKind) => void;
  readonly locate: (nodeId: string) => void;
}

export interface FlowCanvasProps {
  readonly state: EditorState;
  readonly store: EditorStore;
}

export const FlowCanvas = forwardRef<FlowCanvasHandle, FlowCanvasProps>(function FlowCanvas(
  { state, store },
  ref,
) {
  const { getNode, screenToFlowPosition, setCenter } = useReactFlow();
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    setNodes(state.document.nodes.map((n) => toNode(n, n.id === state.selection.nodeId, state.document.startNodeId)));
    setEdges(state.document.edges.map(toEdge));
  }, [state]);

  useImperativeHandle(
    ref,
    () => ({
      add(kind) {
        const center = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        store.dispatch(addNode(defaultNode(kind), { x: center.x, y: center.y }));
      },
      locate(nodeId) {
        const node = getNode(nodeId);
        if (node) {
          setCenter(node.position.x, node.position.y, { zoom: 1, duration: 200 });
        }
        store.dispatch(selectNode(nodeId));
      },
    }),
    [getNode, screenToFlowPosition, setCenter, store],
  );

  const onNodesChange = useCallback((changes: NodeChange<EditorNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      const kind: EdgeKind =
        connection.sourceHandle === 'then'
          ? 'then'
          : connection.sourceHandle === 'else'
            ? 'else'
            : connection.sourceHandle === 'thread'
              ? 'thread'
              : connection.sourceHandle === 'jump'
                ? 'jump'
                : 'next';
      try {
        store.dispatch(connectNodes(connection.source, connection.target, kind));
      } catch {
        // 非法连线（端点约束/重复出边）忽略。
      }
    },
    [store],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: EditorNode) => {
      store.dispatch(selectNode(node.id));
    },
    [store],
  );

  const onPaneClick = useCallback(() => {
    store.dispatch(selectNode(null));
  }, [store]);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: EditorNode) => {
      store.dispatch(moveNode(node.id, { x: node.position.x, y: node.position.y }));
    },
    [store],
  );

  const onNodesDelete = useCallback(
    (deleted: EditorNode[]) => {
      for (const node of deleted) {
        if (node.id !== state.document.startNodeId) {
          store.dispatch({ kind: 'remove_node', id: node.id });
        }
      }
    },
    [state.document.startNodeId, store],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        store.dispatch(disconnectEdge(edge.id));
      }
    },
    [store],
  );

  return (
    <div className="flow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        fitView
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="flow__minimap" />
      </ReactFlow>
    </div>
  );
});
