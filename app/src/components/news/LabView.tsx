import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { List, Maximize2, Network, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SEED_ARTICLES } from '../../data/seed';
import { groupByIndustry, hubPosition, layoutCluster } from '../../lib/labLayout';
import { formatShortDate } from '../../lib/time';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStore } from '../../state/store';
import type { Article } from '../../types';
import { Illustration } from '../Illustration';
import { slug } from '../../lib/slug';

const HUB_COLORS = ['#EEE5FF', '#DDF2E8', '#FFE5D6', '#E9E1FA', '#E3F0F7', '#F7EBD9', '#F1E4F3'];

type HubData = { industry: string; count: number; color: string };
type ArticleData = { article: Article };

function HubNode({ data }: NodeProps<Node<HubData>>) {
  return (
    <div className="lab-hub" style={{ background: data.color }}>
      {data.industry}
      <span className="count">
        {data.count} saved article{data.count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function ArticleNode({ data }: NodeProps<Node<ArticleData>>) {
  return (
    <div className="lab-article" data-testid="lab-article-node">
      <div className="t">{data.article.title.replace(/^Example:\s*/, '')}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {formatShortDate(data.article.date)} · Example
      </div>
    </div>
  );
}

const nodeTypes = { hub: HubNode, article: ArticleNode };

interface Props {
  onOpen: (a: Article) => void;
  onExplore: () => void;
}

export function LabView(props: Props) {
  return (
    <ReactFlowProvider>
      <LabInner {...props} />
    </ReactFlowProvider>
  );
}

function LabInner({ onOpen, onExplore }: Props) {
  const { state, setLabPosition, resetLabPositions } = useStore();
  const narrow = useMediaQuery('(max-width: 760px)');
  const [listView, setListView] = useState(narrow);
  const [industry, setIndustry] = useState<string>('all');
  const { fitView } = useReactFlow();

  const saved = useMemo(() => SEED_ARTICLES.filter((a) => state.savedArticleIds.includes(a.id)), [state.savedArticleIds]);
  const allGroups = useMemo(() => groupByIndustry(saved, state.profile.industries), [saved, state.profile.industries]);
  const groups = industry === 'all' ? allGroups : allGroups.filter((g) => g.industry === industry);
  const visibleIds = groups.flatMap((g) => g.articles.map((a) => a.id));

  // Reset the filter if its industry no longer has saved articles.
  useEffect(() => {
    if (industry !== 'all' && !allGroups.some((g) => g.industry === industry)) setIndustry('all');
  }, [allGroups, industry]);

  const derived = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    groups.forEach((g, i) => {
      const hub = hubPosition(i);
      const color = HUB_COLORS[Math.max(0, allGroups.findIndex((x) => x.industry === g.industry)) % HUB_COLORS.length];
      const hubId = `hub:${g.industry}`;
      nodes.push({ id: hubId, type: 'hub', position: hub, data: { industry: g.industry, count: g.articles.length, color }, draggable: false, selectable: false });
      const offsets = layoutCluster(
        g.articles.map((a) => a.id),
        state.labPositions,
      );
      for (const a of g.articles) {
        const off = offsets[a.id];
        nodes.push({
          id: `article:${a.id}`,
          type: 'article',
          position: { x: hub.x + off.x, y: hub.y + off.y },
          data: { article: a, hubX: hub.x, hubY: hub.y },
          ariaLabel: `${a.title}. Open summary.`,
        });
        edges.push({ id: `e:${hubId}:${a.id}`, source: hubId, target: `article:${a.id}`, style: { stroke: '#C4AFF2', strokeWidth: 2 } });
      }
    });
    return { nodes, edges };
  }, [groups, allGroups, state.labPositions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(derived.nodes);
  useEffect(() => setNodes(derived.nodes), [derived.nodes, setNodes]);

  const dragMoved = useRef(false);
  const suppressClick = useRef(false);

  // Re-fit when the set of visible nodes changes (filter, save/unsave), not on drags.
  const visibleKey = visibleIds.join('|');
  useEffect(() => {
    if (listView) return;
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [visibleKey, listView, fitView]);

  if (saved.length === 0) {
    return (
      <div className="card lab-empty">
        <Illustration kind="idea" size={88} />
        <h2>Your next conversation starts with a good idea</h2>
        <p className="muted" style={{ maxWidth: 440, margin: '8px auto 16px' }}>
          Save articles from the New tab and they will appear here, grouped by industry.
        </p>
        <button type="button" className="btn" onClick={onExplore}>
          Explore news
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="news-toolbar" style={{ justifyContent: 'space-between' }}>
        <div className="chip-row" role="group" aria-label="Filter the map by industry">
          <button type="button" className="chip" aria-pressed={industry === 'all'} onClick={() => setIndustry('all')}>
            All industries
          </button>
          {allGroups.map((g) => (
            <button key={g.industry} type="button" className="chip" aria-pressed={industry === g.industry} onClick={() => setIndustry(g.industry)}>
              {g.industry} ({g.articles.length})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!listView && (
            <>
              <button type="button" className="btn secondary small" onClick={() => fitView({ padding: 0.15, duration: 200 })}>
                <Maximize2 size={15} aria-hidden /> Fit to view
              </button>
              <button
                type="button"
                className="btn secondary small"
                onClick={() => {
                  resetLabPositions(visibleIds);
                  setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 30);
                }}
              >
                <RotateCcw size={15} aria-hidden /> Reset layout
              </button>
            </>
          )}
          <button type="button" className="btn secondary small" aria-pressed={listView} onClick={() => setListView((v) => !v)}>
            {listView ? <Network size={15} aria-hidden /> : <List size={15} aria-hidden />}
            {listView ? 'Map view' : 'List view'}
          </button>
        </div>
      </div>

      {listView ? (
        <div className="lab-list card">
          {groups.map((g) => (
            <section key={g.industry} aria-labelledby={`lab-list-${slug(g.industry)}`}>
              <h3 id={`lab-list-${slug(g.industry)}`} style={{ marginBottom: 8 }}>
                {g.industry} · {g.articles.length}
              </h3>
              <ul>
                {g.articles.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onOpen(a)}>
                      <strong>{a.title}</strong>
                      <span className="muted small" style={{ display: 'block' }}>
                        {formatShortDate(a.date)} · {a.sourceLabel}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="lab-wrap" aria-label="Industry Lab mind map. Drag article cards to arrange them; click a card to open its summary. A list view is available.">
          <ReactFlow
            nodes={nodes}
            edges={derived.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.2}
            maxZoom={1.75}
            nodeDragThreshold={4}
            onNodeDragStart={() => {
              dragMoved.current = false;
            }}
            onNodeDrag={() => {
              dragMoved.current = true;
            }}
            onNodeDragStop={(_, node) => {
              if (node.type !== 'article' || !dragMoved.current) return;
              suppressClick.current = true;
              setTimeout(() => (suppressClick.current = false), 0);
              const d = node.data as ArticleData & { hubX: number; hubY: number };
              setLabPosition(d.article.id, Math.round(node.position.x - d.hubX), Math.round(node.position.y - d.hubY));
            }}
            onNodeClick={(_, node) => {
              if (suppressClick.current || node.type !== 'article') return;
              onOpen((node.data as ArticleData).article);
            }}
            onNodesDelete={() => {}}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="#D9CFEA" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 10 }}>
        Grouped automatically by each article’s primary industry. Positions you set by dragging are saved in this browser.
      </p>
    </div>
  );
}
