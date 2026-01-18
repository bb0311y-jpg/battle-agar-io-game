-- Create a table for public profiles (linked to auth.users)
create table profiles (
  id uuid references auth.users not null primary key,
  username text unique,
  avatar_url text,
  balance integer default 1000, -- Specific funds for betting
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table profiles enable row level security;

-- Policies for Profiles
create policy "Public profiles are viewable by everyone." on profiles
  for select using (true);

create policy "Users can insert their own profile." on profiles
  for insert with check (auth.uid() = id);

create policy "Users can update own profile." on profiles
  for update using (auth.uid() = id);

-- Create a table for Matches (Game Sessions)
create table matches (
  id uuid default uuid_generate_v4() primary key,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  ended_at timestamp with time zone,
  winner_id uuid references profiles(id),
  prize_pool integer default 0,
  players jsonb -- Store list of player IDs or snapshots
);

-- Enable RLS for Matches
alter table matches enable row level security;

create policy "Matches are viewable by everyone." on matches
  for select using (true);

create policy "Server or Players can insert matches." on matches
  for insert with check (true); -- Simplified for demo

-- Function to handle new user signup (Trigger)
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, balance)
  values (new.id, new.raw_user_meta_data->>'username', 1000);
  return new;
end;
$$ language plpgsql security definer;

-- Trigger the function every time a user is created
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
