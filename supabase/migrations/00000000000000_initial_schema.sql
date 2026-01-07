-- Inworld Language Tutor - Complete Database Schema
-- Run with: npx supabase db push
-- This creates all tables, indexes, RLS policies, and functions

--------------------------------------------------------------------------------
-- Extensions
--------------------------------------------------------------------------------

-- Enable pgvector for semantic memory search
create extension if not exists vector;

--------------------------------------------------------------------------------
-- Core Tables
--------------------------------------------------------------------------------

-- User preferences (language preference)
create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null unique,
  language_code text default 'es' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Conversations (multi-conversation support, per language)
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  language_code text not null,
  title text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Conversation messages (belong to a conversation)
create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  role text check (role in ('user', 'assistant')) not null,
  content text not null,
  created_at timestamptz default now() not null
);

-- Flashcards (per user per conversation)
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  language_code text not null,
  conversation_id uuid references public.conversations(id) on delete cascade,
  target_word text not null,
  english text not null,
  example text,
  mnemonic text,
  created_at timestamptz default now() not null,
  unique(user_id, conversation_id, target_word)
);

--------------------------------------------------------------------------------
-- Memory System (pgvector)
--------------------------------------------------------------------------------

-- User memories with embeddings for semantic search
create table public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  memory_type text check (memory_type in ('learning_progress', 'personal_context')) not null,
  topics text[] default '{}',
  importance float default 0.5,
  embedding vector(1024), -- BAAI/bge-large-en-v1.5 model
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

--------------------------------------------------------------------------------
-- Indexes
--------------------------------------------------------------------------------

-- Core table indexes
create index idx_conversations_user_lang on public.conversations(user_id, language_code, updated_at desc);
create index idx_messages_conversation on public.conversation_messages(conversation_id, created_at);
create index idx_flashcards_conversation on public.flashcards(user_id, conversation_id);

-- Memory indexes
create index idx_memories_embedding on public.user_memories
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index idx_memories_user on public.user_memories(user_id, created_at desc);

--------------------------------------------------------------------------------
-- Row Level Security
--------------------------------------------------------------------------------

alter table public.user_preferences enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.flashcards enable row level security;
alter table public.user_memories enable row level security;

-- RLS Policies (users can only access their own data)
-- Note: Service role key bypasses RLS, which is what the backend uses
create policy "Users manage own preferences" on public.user_preferences for all using (auth.uid() = user_id);
create policy "Users manage own conversations" on public.conversations for all using (auth.uid() = user_id);
create policy "Users manage own messages" on public.conversation_messages for all
  using (conversation_id in (select id from public.conversations where user_id = auth.uid()));
create policy "Users manage own flashcards" on public.flashcards for all using (auth.uid() = user_id);
create policy "Users manage own memories" on public.user_memories for all using (auth.uid() = user_id);

--------------------------------------------------------------------------------
-- Functions
--------------------------------------------------------------------------------

-- Search memories by cosine similarity (optimized for index usage)
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
    and user_memories.embedding <=> query_embedding < (1 - match_threshold)
  order by user_memories.embedding <=> query_embedding
  limit match_count;
$$;

-- Trigger function to auto-update timestamps
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
