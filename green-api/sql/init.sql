-- ------------------------------------------------------------
-- Green Commute demo DB schema (MySQL / MariaDB compatible)
-- JSON oszlopok helyett LONGTEXT a jobb kompatibilitás miatt
-- ------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS green_commute
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE green_commute;

-- ------------------------------------------------------------
-- 1) Incoming mobility events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(64) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  trip_type ENUM('bus','rail','monorail','park&ride') NOT NULL,
  distance_km DECIMAL(10,2) NULL,
  route_id VARCHAR(64) NULL,
  stop_id VARCHAR(64) NULL,
  source VARCHAR(64) NULL,
  event_ts_ms BIGINT UNSIGNED NULL,
  event_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_events_event_id (event_id),

  KEY idx_events_wallet (wallet_address),
  KEY idx_events_trip_type (trip_type),
  KEY idx_events_source (source),
  KEY idx_events_event_time (event_time),
  KEY idx_events_wallet_time (wallet_address, event_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2) Avatar layouts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avatar_layouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  layout_json LONGTEXT NOT NULL,                      -- JSON string
  signature TEXT NULL,
  saved_by_source VARCHAR(32) NOT NULL DEFAULT 'api',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_avatar_layout_wallet (wallet_address),
  KEY idx_avatar_layout_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 3) Community user profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  display_name VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_user_profiles_wallet (wallet_address),
  UNIQUE KEY uq_user_profiles_display_name (display_name),
  KEY idx_user_profiles_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4) Friend requests
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS friend_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  requester_wallet VARCHAR(42) NOT NULL,
  addressee_wallet VARCHAR(42) NOT NULL,
  status ENUM('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
  responded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_friend_request_pair (requester_wallet, addressee_wallet),
  KEY idx_friend_requests_requester (requester_wallet),
  KEY idx_friend_requests_addressee (addressee_wallet),
  KEY idx_friend_requests_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 5) Groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS groups_social (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_wallet VARCHAR(42) NOT NULL,
  name VARCHAR(48) NOT NULL,
  description VARCHAR(240) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_groups_social_owner (owner_wallet),
  KEY idx_groups_social_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  member_role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_group_members_group_wallet (group_id, wallet_address),
  KEY idx_group_members_group (group_id),
  KEY idx_group_members_wallet (wallet_address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_invites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  inviter_wallet VARCHAR(42) NOT NULL,
  invitee_wallet VARCHAR(42) NOT NULL,
  status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
  responded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_group_invites_group_invitee (group_id, invitee_wallet),
  KEY idx_group_invites_group (group_id),
  KEY idx_group_invites_invitee (invitee_wallet),
  KEY idx_group_invites_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 6) Direct messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_wallet VARCHAR(42) NOT NULL,
  recipient_wallet VARCHAR(42) NOT NULL,
  message_text VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_direct_messages_sender (sender_wallet),
  KEY idx_direct_messages_recipient (recipient_wallet),
  KEY idx_direct_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 7) Group messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  sender_wallet VARCHAR(42) NOT NULL,
  message_text VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_group_messages_group (group_id),
  KEY idx_group_messages_sender (sender_wallet),
  KEY idx_group_messages_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 8) Avatar/social extras
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outfit_presets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  preset_name VARCHAR(48) NOT NULL,
  layout_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_outfit_presets_wallet (wallet_address),
  KEY idx_outfit_presets_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_presence (
  wallet_address VARCHAR(42) NOT NULL,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_source VARCHAR(48) NULL,
  PRIMARY KEY (wallet_address),
  KEY idx_user_presence_active (last_active_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS direct_message_reads (
  reader_wallet VARCHAR(42) NOT NULL,
  other_wallet VARCHAR(42) NOT NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reader_wallet, other_wallet),
  KEY idx_direct_message_reads_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_message_reads (
  group_id BIGINT UNSIGNED NOT NULL,
  reader_wallet VARCHAR(42) NOT NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, reader_wallet),
  KEY idx_group_message_reads_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(80) NOT NULL,
  target_km DECIMAL(12,2) NOT NULL,
  created_by_wallet VARCHAR(42) NOT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  completed_at DATETIME NULL,
  bonus_points DECIMAL(12,2) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_group_challenges_group (group_id),
  KEY idx_group_challenges_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profile_likes (
  target_wallet VARCHAR(42) NOT NULL,
  liker_wallet VARCHAR(42) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_wallet, liker_wallet),
  KEY idx_profile_likes_liker (liker_wallet)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outfit_likes (
  target_wallet VARCHAR(42) NOT NULL,
  liker_wallet VARCHAR(42) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (target_wallet, liker_wallet),
  KEY idx_outfit_likes_liker (liker_wallet)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS group_reward_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  group_id BIGINT UNSIGNED NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  reward_code VARCHAR(64) NOT NULL,
  reward_item_id VARCHAR(100) NULL,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json LONGTEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_group_reward_unique (group_id, wallet_address, reward_code),
  KEY idx_group_reward_wallet (wallet_address),
  KEY idx_group_reward_code (reward_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 9) Reward claims
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reward_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  amount_tokens DECIMAL(18,6) NOT NULL,
  nonce VARCHAR(80) NOT NULL,
  expiry_ts_ms BIGINT UNSIGNED NULL,
  signature_hash VARCHAR(66) NULL,
  claim_status ENUM('signed','submitted','confirmed','failed') NOT NULL DEFAULT 'signed',
  tx_hash VARCHAR(66) NULL,
  chain_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_reward_claim_wallet_nonce (wallet_address, nonce),
  KEY idx_reward_claim_wallet (wallet_address),
  KEY idx_reward_claim_status (claim_status),
  KEY idx_reward_claim_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 10) Shop purchases
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shop_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  item_name VARCHAR(150) NULL,
  slot_name VARCHAR(32) NULL,
  price_tokens DECIMAL(18,6) NOT NULL,
  purchase_mode ENUM('demo-local','api','onchain') NOT NULL DEFAULT 'demo-local',
  tx_hash VARCHAR(66) NULL,
  chain_id BIGINT UNSIGNED NULL,
  metadata_json LONGTEXT NULL,                        -- JSON string
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_shop_wallet (wallet_address),
  KEY idx_shop_item (item_id),
  KEY idx_shop_slot (slot_name),
  KEY idx_shop_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 11) Voucher redemptions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  voucher_id VARCHAR(100) NOT NULL,
  wallet_address VARCHAR(42) NOT NULL,
  voucher_type VARCHAR(64) NOT NULL,
  token_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
  coupon_code VARCHAR(100) NULL,
  status ENUM('issued','used','expired','cancelled') NOT NULL DEFAULT 'issued',
  metadata_json LONGTEXT NULL,                        -- JSON string
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_voucher_id (voucher_id),
  KEY idx_voucher_wallet (wallet_address),
  KEY idx_voucher_type (voucher_type),
  KEY idx_voucher_status (status),
  KEY idx_voucher_issued (issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 12) Donations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  amount_tokens DECIMAL(18,6) NOT NULL,
  donation_mode ENUM('demo-local','api','onchain') NOT NULL DEFAULT 'demo-local',
  tx_hash VARCHAR(66) NULL,
  chain_id BIGINT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_donation_wallet (wallet_address),
  KEY idx_donation_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 13) Streak boost activations
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS streak_boost_activations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  boost_type VARCHAR(64) NOT NULL,
  token_cost DECIMAL(18,6) NOT NULL DEFAULT 0,
  status ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  metadata_json LONGTEXT NULL,                        -- JSON string
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_streak_wallet (wallet_address),
  KEY idx_streak_boost_type (boost_type),
  KEY idx_streak_status (status),
  KEY idx_streak_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 14) Stamp progress
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stamp_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  set_id VARCHAR(64) NOT NULL,
  progress_json LONGTEXT NOT NULL,                    -- JSON string
  completed TINYINT(1) NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_stamp_wallet_set (wallet_address, set_id),
  KEY idx_stamp_wallet (wallet_address),
  KEY idx_stamp_completed (completed),
  KEY idx_stamp_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 15) Achievement badges
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_badges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  achievement_id VARCHAR(64) NOT NULL,
  badge_type ENUM('demo','nft','soulbound') NOT NULL DEFAULT 'demo',
  token_id BIGINT UNSIGNED NULL,
  tx_hash VARCHAR(66) NULL,
  chain_id BIGINT UNSIGNED NULL,
  metadata_json LONGTEXT NULL,                        -- JSON string
  minted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_badge_wallet_achievement (wallet_address, achievement_id),
  KEY idx_badge_wallet (wallet_address),
  KEY idx_badge_type (badge_type),
  KEY idx_badge_minted (minted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 16) API ingest log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_ingest_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  endpoint VARCHAR(120) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INT NOT NULL,
  source_ip VARCHAR(64) NULL,
  request_body_json LONGTEXT NULL,                    -- JSON string
  response_body_json LONGTEXT NULL,                   -- JSON string
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_ingest_endpoint (endpoint),
  KEY idx_ingest_status (status_code),
  KEY idx_ingest_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 17) Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  wallet_address VARCHAR(42) NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(120) NOT NULL,
  body VARCHAR(255) NOT NULL,
  ref_type VARCHAR(32) NULL,
  ref_id BIGINT UNSIGNED NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_notifications_wallet (wallet_address),
  KEY idx_notifications_read (wallet_address, is_read),
  KEY idx_notifications_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 18) Cosmetic transfers (on-chain trade / transfer history)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cosmetic_transfers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tx_hash VARCHAR(66) NOT NULL,
  chain_id BIGINT UNSIGNED NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  token_id BIGINT UNSIGNED NOT NULL,
  from_wallet VARCHAR(42) NOT NULL,
  to_wallet VARCHAR(42) NOT NULL,
  operator_wallet VARCHAR(42) NULL,
  amount INT UNSIGNED NOT NULL DEFAULT 1,
  metadata_json LONGTEXT NULL,                        -- JSON string
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_cosmetic_transfers_tx (tx_hash),
  KEY idx_cosmetic_transfers_from (from_wallet),
  KEY idx_cosmetic_transfers_to (to_wallet),
  KEY idx_cosmetic_transfers_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 18) Trade listings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_wallet VARCHAR(42) NOT NULL,
  item_id VARCHAR(100) NOT NULL,
  note VARCHAR(240) NULL,
  listing_status ENUM('open','accepted','cancelled') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_trade_listings_owner (owner_wallet),
  KEY idx_trade_listings_status (listing_status),
  KEY idx_trade_listings_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 19) Trade offers
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_offers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id BIGINT UNSIGNED NOT NULL,
  offerer_wallet VARCHAR(42) NOT NULL,
  offered_item_id VARCHAR(100) NOT NULL,
  note VARCHAR(240) NULL,
  offer_status ENUM('pending','accepted','rejected','cancelled') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_trade_offers_listing (listing_id),
  KEY idx_trade_offers_offerer (offerer_wallet),
  KEY idx_trade_offers_status (offer_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
