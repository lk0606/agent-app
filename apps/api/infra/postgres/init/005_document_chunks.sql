-- E.7-B：沙箱文档切块 + embedding 向量持久化（JSONB，不依赖 pgvector 扩展）。
-- rag:index 离线写入；search_docs 在 vector/hybrid 模式下从此表加载检索。
create table if not exists document_chunks (
  id bigserial primary key,
  source_path text not null,
  chunk_index integer not null,
  text text not null,
  -- OpenAI 兼容 embedding API 返回的浮点向量；应用层算余弦相似度
  embedding jsonb not null,
  indexed_at timestamptz not null default now(),
  unique (source_path, chunk_index)
);

create index if not exists idx_document_chunks_source_path
  on document_chunks(source_path);
