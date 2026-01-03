-- Inworld Language Tutor - Supabase Schema
-- Run this in your Supabase SQL Editor to set up the database

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

-- Indexes
create index idx_conversations_user_lang on public.conversations(user_id, language_code, updated_at desc);
create index idx_messages_conversation on public.conversation_messages(conversation_id, created_at);
create index idx_flashcards_conversation on public.flashcards(user_id, conversation_id);

-- Enable Row Level Security
alter table public.user_preferences enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.flashcards enable row level security;

-- RLS Policies (users can only access their own data)
create policy "Users manage own preferences" on public.user_preferences for all using (auth.uid() = user_id);
create policy "Users manage own conversations" on public.conversations for all using (auth.uid() = user_id);
create policy "Users manage own messages" on public.conversation_messages for all
  using (conversation_id in (select id from public.conversations where user_id = auth.uid()));
create policy "Users manage own flashcards" on public.flashcards for all using (auth.uid() = user_id);
