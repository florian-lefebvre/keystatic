import { Node, NodeType, Schema } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
} from 'prosemirror-state';
import { NodeView } from 'prosemirror-view';
import {
  ReactElement,
  ReactNode,
  memo,
  useCallback,
  useLayoutEffect,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditorViewRef } from './editor-view';
import { css } from '@keystar/ui/style';

type NodeViewInfo = {
  key: string;
  node: Node;
  dom: HTMLElement;
  contentDOM: HTMLElement | undefined;
  getPos: () => number | undefined;
};

type ReactNodeViewsState = {
  nodeViews: Map<string, NodeViewInfo>;
  callbacks: Set<() => void>;
  register: (callback: () => void) => () => void;
};

let i = 0;

type ReactNodeViewProps = {
  hasNodeSelection: boolean;
  isNodeCompletelyWithinSelection: boolean;
  node: Node;
  children: ReactNode;
  getPos: () => number | undefined;
};

type ReactNodeViewSpec = {
  component: (props: ReactNodeViewProps) => ReactNode;
  rendersOwnContent?: boolean;
};

export type WithReactNodeViewSpec = {
  reactNodeView?: ReactNodeViewSpec;
};

function NodeViewContentDOM(props: { node: HTMLElement }) {
  const viewRef = useEditorViewRef();
  return (
    <span
      className={displayContentsClassName}
      ref={useCallback(
        (element: HTMLSpanElement | null) => {
          if (!element) return;
          element.appendChild(props.node);

          const view = viewRef.current;
          if (!view) return;
          if (view.hasFocus()) {
            view.focus();
          }
        },
        [props.node, viewRef]
      )}
    />
  );
}

const NodeViewWrapper = memo(function NodeViewWrapper(props: {
  node: Node;
  contentDOM: HTMLElement | undefined;
  component: (props: ReactNodeViewProps) => ReactElement | null;
  hasNodeSelection: boolean;
  isNodeCompletelyWithinSelection: boolean;
  getPos: () => number | undefined;
}) {
  return (
    <props.component
      node={props.node}
      getPos={props.getPos}
      hasNodeSelection={props.hasNodeSelection}
      isNodeCompletelyWithinSelection={props.isNodeCompletelyWithinSelection}
      children={
        props.contentDOM ? <NodeViewContentDOM node={props.contentDOM} /> : null
      }
    />
  );
});

export function NodeViews(props: { state: EditorState }): ReactElement | null {
  const pluginState = reactNodeViewKey.getState(props.state)!;
  const [nodeViews, setNodeViews] = useState(pluginState.nodeViews);
  useLayoutEffect(() => {
    return pluginState.register(() => {
      setNodeViews(pluginState.nodeViews);
    });
  });
  const nodeSelectionPos =
    props.state.selection instanceof NodeSelection
      ? props.state.selection.from
      : undefined;
  const selectionFrom = props.state.selection.from;
  const selectionTo = props.state.selection.to;

  return (
    <>
      {[...nodeViews].map(([key, { contentDOM, dom, node, getPos }]) => {
        const nodeViewSpec = getReactNodeViewSpec(node.type);
        if (!nodeViewSpec) return null;
        const pos = getPos();
        if (pos === undefined) return null;
        return createPortal(
          <NodeViewWrapper
            hasNodeSelection={nodeSelectionPos === pos}
            isNodeCompletelyWithinSelection={
              pos >= selectionFrom && pos + node.nodeSize <= selectionTo
            }
            node={node}
            contentDOM={contentDOM}
            component={nodeViewSpec.component as any}
            getPos={getPos}
          />,
          dom,
          key
        );
      })}
    </>
  );
}

function getReactNodeViewSpec(type: NodeType): ReactNodeViewSpec | undefined {
  return type.spec.reactNodeView as ReactNodeViewSpec | undefined;
}

const displayContentsClassName = css({ display: 'contents' });

function elementWithDisplayContents(tag: keyof HTMLElementTagNameMap) {
  const element = document.createElement(tag);
  element.classList.add(displayContentsClassName);
  return element;
}

const reactNodeViewKey = new PluginKey<ReactNodeViewsState>('reactNodeViews');

export function reactNodeViews(schema: Schema) {
  const nodes = new Set<NodeType>();
  for (const nodeType of Object.values(schema.nodes)) {
    if (nodeType.spec.reactNodeView) {
      nodes.add(nodeType);
    }
  }
  const plugin = new Plugin<ReactNodeViewsState>({
    key: reactNodeViewKey,
    state: {
      init() {
        const callbacks = new Set<() => void>();
        return {
          nodeViews: new Map(),
          callbacks,
          register: callback => {
            callbacks.add(callback);
            return () => {
              callbacks.delete(callback);
            };
          },
        };
      },
      apply(tr, pluginState) {
        return pluginState;
      },
    },
    props: {
      nodeViews: Object.fromEntries(
        [...nodes].map(node => [
          node.name,
          (node, view, getPos): NodeView => {
            const { type } = node;
            const reactNodeViewSpec = getReactNodeViewSpec(type);

            const dom = document.createElement(type.isInline ? 'span' : 'div');
            const contentDOM =
              reactNodeViewSpec?.rendersOwnContent || type.isLeaf
                ? undefined
                : elementWithDisplayContents(
                    type.inlineContent ? 'div' : 'span'
                  );

            const key = `${i++}`;
            const info: NodeViewInfo = { contentDOM, dom, getPos, key, node };
            const pluginState = reactNodeViewKey.getState(view.state)!;
            pluginState.nodeViews.set(key, info);

            const cb = () => {
              for (const callback of pluginState.callbacks) {
                callback();
              }
            };
            cb();

            return {
              dom,
              contentDOM,
              destroy() {
                pluginState.nodeViews.delete(key);
                cb();
              },
              ignoreMutation(mutation) {
                return !contentDOM?.contains(mutation.target);
              },
              deselectNode() {},
              selectNode() {},
              update(node) {
                if (node.type !== type) return false;
                pluginState.nodeViews.set(key, {
                  ...info,
                  node,
                });
                cb();
                return true;
              },
            };
          },
        ])
      ),
    },
  });
  return plugin;
}
