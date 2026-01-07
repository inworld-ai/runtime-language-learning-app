-- Memory System Migration
-- Adds user_memories table with pgvector for semantic memory retrieval

-- Enable pgvector extension for vector similarity search
create extension if not exists vector;

-- User memories table (English only)
create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,

  -- Memory content (English)
  content text not null,

  -- Metadata
  memory_type text check (memory_type in ('learning_progress', 'personal_context')) not null,
  topics text[] default '{}',
  importance float default 0.5,

  -- Embedding (1024 dim for BAAI/bge-large-en-v1.5)
  embedding vector(1024),

  -- Timestamps
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Index for vector similarity search using IVFFlat
-- lists = 100 is a reasonable default; adjust based on table size
create index idx_memories_embedding on public.user_memories
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Index for user-based queries
create index idx_memories_user on public.user_memories(user_id, created_at desc);

-- Enable Row Level Security
alter table public.user_memories enable row level security;

-- RLS Policy: Users can only manage their own memories
-- Note: Service role key bypasses RLS, which is what the backend uses
create policy "Users manage own memories" on public.user_memories
  for all using (auth.uid() = user_id);

-- Function to search memories by cosine similarity
create or replace function match_memories(
  query_embedding vector(1024),
  match_user_id uuid,
  match_threshold float default 0.7,
  match_count int default 3
)
returns table (
  id uuid,
  content text,
  memory_type text,
  topics text[],
  importance float,
  similarity float
)
language sql stable
as $$
  select
    user_memories.id,
    user_memories.content,
    user_memories.memory_type,
    user_memories.topics,
    user_memories.importance,
    1 - (user_memories.embedding <=> query_embedding) as similarity
  from user_memories
  where user_memories.user_id = match_user_id
    and user_memories.embedding is not null
    and 1 - (user_memories.embedding <=> query_embedding) > match_threshold
  order by user_memories.embedding <=> query_embedding
  limit match_count;
$$;

-- Trigger to update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_user_memories_updated_at
  before update on public.user_memories
  for each row
  execute function update_updated_at_column();
