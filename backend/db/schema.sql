-- Database Schema for Evangadi Forum
-- Platform: MySQL 

SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- 1. Users Table
-- Stores user account information.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
    `user_id` INT AUTO_INCREMENT PRIMARY KEY,
    `first_name` VARCHAR(50) NOT NULL,
    `last_name` VARCHAR(50) NOT NULL,
    `email` VARCHAR(320) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'user',        -- 'user' | 'admin'
    `is_active` TINYINT(1) NOT NULL DEFAULT 1,          -- 1 = active, 0 = deactivated
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (`email` = LOWER(`email`)),
    
    INDEX `idx_users_email` (`email`),
    INDEX `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. Questions Table
-- Stores the main questions posted by users.
-- Supports full-text search on title and content for exact match search.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `questions`;
CREATE TABLE `questions` (
    `question_id` INT AUTO_INCREMENT PRIMARY KEY,
    `question_hash` CHAR(16) NOT NULL UNIQUE, -- Used for /question/:hash routing
    `user_id` INT NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `content` TEXT NOT NULL, -- Detailed content including code sections
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (CHAR_LENGTH(`title`) >= 5),
    CHECK (CHAR_LENGTH(`content`) >= 10),
    
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    
    INDEX `idx_questions_user_id` (`user_id`),
    INDEX `idx_questions_created_at` (`created_at`),
    
    -- Full-text search index for exact match search mode
    FULLTEXT KEY `ft_questions_search` (`title`, `content`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. Question Vectors Table
-- Stores embeddings for the AI Semantic Search feature (Gemini default model).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `question_vectors`;
CREATE TABLE `question_vectors` (
    `vector_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `question_id` INT NOT NULL,
    `source_text` TEXT NOT NULL, -- Text used to generate the embedding
    `embedding` JSON NOT NULL,   -- Gemini embedding vector
    `status` VARCHAR(20) DEFAULT 'ready', -- e.g., 'ready', 'pending', 'failed'
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE,
    UNIQUE KEY `uniq_question_vectors_question_id` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. Answers Table
-- Stores answers to questions.
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `answers`;
CREATE TABLE `answers` (
    `answer_id` INT AUTO_INCREMENT PRIMARY KEY,
    `question_id` INT NOT NULL,
    `user_id` INT NOT NULL,
    `content` TEXT NOT NULL, -- Content including code sections
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    
    INDEX `idx_answers_question_id` (`question_id`),
    INDEX `idx_answers_user_id` (`user_id`),
    INDEX `idx_answers_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 5. Answer Votes Table
-- Stores up/down votes on answers. One row per (user, answer).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `answer_votes`;
CREATE TABLE `answer_votes` (
    `user_id` INT NOT NULL,
    `answer_id` INT NOT NULL,
    `vote` TINYINT NOT NULL DEFAULT 1, -- 1 = upvote, -1 = downvote
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (`user_id`, `answer_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    FOREIGN KEY (`answer_id`) REFERENCES `answers`(`answer_id`) ON DELETE CASCADE,

    INDEX `idx_answer_votes_answer_id` (`answer_id`),
    CONSTRAINT `chk_answer_votes_value` CHECK (`vote` IN (-1, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 6. Answer Vectors Table
-- Stores embeddings for answers so threads can be ranked by AI relevance
-- against the question embedding (blended with the net vote score).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `answer_vectors`;
CREATE TABLE `answer_vectors` (
    `vector_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `answer_id` INT NOT NULL,
    `source_text` TEXT NOT NULL, -- Text used to generate the embedding
    `embedding` JSON NOT NULL,   -- Gemini embedding vector
    `status` VARCHAR(20) DEFAULT 'ready', -- e.g., 'ready', 'pending', 'failed'
    `ai_grade` VARCHAR(16) DEFAULT NULL, -- Gemini recommendation: 'Good', 'Moderate', 'Low'
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`answer_id`) REFERENCES `answers`(`answer_id`) ON DELETE CASCADE,
    UNIQUE KEY `uniq_answer_vectors_answer_id` (`answer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 7. Notifications Table
-- Stores per-user activity alerts (e.g. "someone answered your question").
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
    `notification_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,                 -- Recipient (the question author)
    `type` VARCHAR(32) NOT NULL DEFAULT 'answer_added',
    `message` VARCHAR(512) NOT NULL,        -- Pre-rendered human-readable text
    `question_id` INT NOT NULL,             -- Thread this notification points to
    `question_hash` CHAR(16) NOT NULL,      -- Used for /questions/:hash routing
    `is_read` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    FOREIGN KEY (`question_id`) REFERENCES `questions`(`question_id`) ON DELETE CASCADE,

    INDEX `idx_notifications_user_read` (`user_id`, `is_read`, `created_at`),
    INDEX `idx_notifications_question` (`question_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 8. RAG: user-owned PDF documents, text chunks, and chunk embeddings
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS `documents`;
CREATE TABLE `documents` (
    `document_id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT NOT NULL,
    `title` VARCHAR(512) NOT NULL,
    `mime_type` VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    `storage_path` VARCHAR(1024) NOT NULL,
    `byte_size` BIGINT NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `error_message` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    INDEX `idx_documents_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `document_chunks`;
CREATE TABLE `document_chunks` (
    `chunk_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `document_id` INT NOT NULL,
    `chunk_index` INT NOT NULL,
    `content` TEXT NOT NULL,
    `page_start` INT NULL,
    `page_end` INT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`document_id`) REFERENCES `documents`(`document_id`) ON DELETE CASCADE,
    UNIQUE KEY `uniq_document_chunks_doc_index` (`document_id`, `chunk_index`),
    INDEX `idx_document_chunks_document_id` (`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `document_chunk_vectors`;
CREATE TABLE `document_chunk_vectors` (
    `chunk_vector_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `chunk_id` BIGINT NOT NULL,
    `source_text` TEXT NOT NULL,
    `embedding` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ready',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`chunk_id`) REFERENCES `document_chunks`(`chunk_id`) ON DELETE CASCADE,
    UNIQUE KEY `uniq_chunk_vectors_chunk_id` (`chunk_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
