-- OppTracker Supabase Schema (matches actual Supabase table)
-- Run this in Supabase SQL Editor: Dashboard → SQL Editor → New query

-- Create opportunities table
CREATE TABLE IF NOT EXISTS public.opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "Type" TEXT NULL,
  "Job Role" TEXT NOT NULL,
  "Company" TEXT NULL DEFAULT '',
  "Field" TEXT NOT NULL,
  "Duration" TEXT NULL DEFAULT '',
  "Location" TEXT NULL DEFAULT '',
  "Package (Stipend)" TEXT NULL,
  "Mode" TEXT NULL,
  "Required Skill" TEXT NULL,
  "Eligibility" TEXT NULL,
  "Application Deadline" DATE NULL
) TABLESPACE pg_default;

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'user',
  college TEXT DEFAULT '',
  year TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  fields TEXT[] DEFAULT '{}',
  interests TEXT[] DEFAULT '{}',
  saved_opportunities TEXT[] DEFAULT '{}',
  onboarding_complete BOOLEAN DEFAULT false,
  notification_email BOOLEAN DEFAULT true,
  notification_whatsapp BOOLEAN DEFAULT false,
  whatsapp_number TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe to run even if they don't exist)
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Anyone can view opportunities" ON opportunities;
DROP POLICY IF EXISTS "Authenticated users can insert opportunities" ON opportunities;

-- RLS Policies for user_profiles: authenticated users can manage their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- RLS Policies for opportunities: everyone can read, authenticated can write
CREATE POLICY "Anyone can view opportunities"
  ON opportunities FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert opportunities"
  ON opportunities FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Create reminders table
CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  company TEXT DEFAULT '',
  role TEXT DEFAULT '',
  deadline TIMESTAMPTZ NOT NULL,
  remind_at TIMESTAMPTZ NOT NULL,
  sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, opportunity_id)
);

-- Enable RLS for reminders
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reminders" ON reminders;
DROP POLICY IF EXISTS "Users can insert own reminders" ON reminders;
DROP POLICY IF EXISTS "Users can delete own reminders" ON reminders;

CREATE POLICY "Users can view own reminders"
  ON reminders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reminders"
  ON reminders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own reminders"
  ON reminders FOR DELETE
  USING (auth.uid() = user_id);
