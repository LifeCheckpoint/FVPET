/**
 * 流程图主画布：React Flow 与 EditorStore 的接线层。
 * - 节点/边从 store 派生，拖拽结束写回 moveNode。
 * - 连线通过节点把手（Handle）发起：branch 有 then/else 两个源把手，
 *   thread 有 thread 源把手，其余为普通 next。
 * - 点击节点同步 store 选中态；Backspace/Delete 删除节点（START 节点 deletable=false）。
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
import type { IrNode } from '@hcb-editor/hcb/ir';

type EditorNodeData = { readonly docNode: DocNode; readonly isStart: boolean };
type EditorNode = Node<EditorNodeData, 'editor'>;

interface ContextMenuState {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

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

/** 复制节点时深拷贝 IR：raw 的字节/重定位需单独克隆，branch/jump/thread 的目标标签重置（连线不复制）。 */
function cloneIrNodeForCopy(node: IrNode): IrNode {
  switch (node.kind) {
    case 'raw':
      return {
        ...node,
        bytes: node.bytes.slice(),
        relocations: node.relocations.map((r) => ({ ...r })),
        sideEffects: {
          touchesGlobals: [...node.sideEffects.touchesGlobals],
          refsStrings: [...node.sideEffects.refsStrings],
        },
      };
    case 'branch':
      return { ...node, cond: { ...node.cond }, then: '', else: '' };
    case 'jump':
      return { ...node, target: '' };
    case 'thread':
      return { ...node, entry: '' };
    case 'selset':
      return { ...node, choices: node.choices.map((c) => ({ ...c })) };
    case 'bsset':
      return { ...node, position: { ...node.position } };
    default:
      return { ...node };
  }
}

/** 找到距 nodeId 最近的「有效」节点：从开始可达、且尚无 next 出边（即剧情链尾）。 */
function findQuickConnectTarget(state: EditorState, nodeId: string): string | null {
  const { document } = state;
  const self = document.nodes.find((n) => n.id === nodeId);
  if (!self) {
    return null;
  }
  const adj = new Map<string, string[]>();
  for (const e of document.edges) {
    const list = adj.get(e.source);
    if (list) {
      list.push(e.target);
    } else {
      adj.set(e.source, [e.target]);
    }
  }
  const reachable = new Set<string>();
  const queue = [document.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) {
      continue;
    }
    reachable.add(id);
    for (const t of adj.get(id) ?? []) {
      if (!reachable.has(t)) {
        queue.push(t);
      }
    }
  }
  const hasNextOut = new Set(document.edges.filter((e) => e.kind === 'next').map((e) => e.source));
  let best: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const n of document.nodes) {
    if (n.id === nodeId) {
      continue;
    }
    if (!reachable.has(n.id)) {
      continue;
    }
    if (hasNextOut.has(n.id)) {
      continue;
    }
    const dx = n.x - self.x;
    const dy = n.y - self.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = n.id;
    }
  }
  return best;
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
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

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

  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: EditorNode) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const onPaneClick = useCallback(() => {
    store.dispatch(selectNode(null));
    setMenu(null);
  }, [store]);

  const closeMenu = useCallback(() => setMenu(null), []);

  const quickTarget = menu ? findQuickConnectTarget(state, menu.nodeId) : null;

  const copySelected = useCallback(() => {
    if (!menu) {
      return;
    }
    const src = state.document.nodes.find((n) => n.id === menu.nodeId);
    if (src) {
      store.dispatch(addNode(cloneIrNodeForCopy(src.node), { x: src.x + 32, y: src.y + 32 }));
    }
    setMenu(null);
  }, [menu, state.document.nodes, store]);

  const deleteSelected = useCallback(() => {
    if (!menu) {
      return;
    }
    if (menu.nodeId !== state.document.startNodeId) {
      store.dispatch({ kind: 'remove_node', id: menu.nodeId });
    }
    setMenu(null);
  }, [menu, state.document.startNodeId, store]);

  const quickConnectSelected = useCallback(() => {
    if (!menu) {
      return;
    }
    const target = findQuickConnectTarget(state, menu.nodeId);
    if (target) {
      try {
        store.dispatch(connectNodes(target, menu.nodeId, 'next'));
      } catch {
        // 忽略非法连线（端点状态在菜单打开期间变化等）。
      }
    }
    setMenu(null);
  }, [menu, state, store]);

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
        onNodeContextMenu={onNodeContextMenu}
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

      {menu && (
        <>
          <div
            className="flow-context-backdrop"
            onMouseDown={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div className="flow-context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <button type="button" className="flow-context-menu__item" role="menuitem" onClick={copySelected}>
              复制节点
            </button>
            <button
              type="button"
              className="flow-context-menu__item flow-context-menu__item--danger"
              role="menuitem"
              disabled={menu.nodeId === state.document.startNodeId}
              onClick={deleteSelected}
            >
              删除节点
            </button>
            <div className="flow-context-menu__sep" />
            <button
              type="button"
              className="flow-context-menu__item"
              role="menuitem"
              disabled={quickTarget === null}
              onClick={quickConnectSelected}
              title={quickTarget === null ? '没有可连接的有效节点（从开始可达且尚无后续连线）' : undefined}
            >
              快速连接到最近有效节点
            </button>
          </div>
        </>
      )}
    </div>
  );
});
