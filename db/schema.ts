import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const users=sqliteTable('users',{id:text().primaryKey(),username:text().notNull().unique(),name:text().notNull(),password:text().notNull(),role:text().notNull(),mustChange:integer('must_change').notNull().default(1),active:integer().notNull().default(1),created:integer().notNull()});
export const settings=sqliteTable('settings',{key:text().primaryKey(),value:text().notNull()});
export const sessions=sqliteTable('sessions',{token:text().primaryKey(),userId:text('user_id').notNull(),expires:integer().notNull()},t=>[index('sessions_user').on(t.userId)]);
export const limits=sqliteTable('limits',{key:text().primaryKey(),count:integer().notNull(),reset:integer().notNull()});
export const albums=sqliteTable('albums',{id:text().primaryKey(),owner:text().notNull(),name:text().notNull()},t=>[index('albums_owner').on(t.owner)]);
export const media=sqliteTable('media',{id:text().primaryKey(),owner:text().notNull(),name:text().notNull(),type:text().notNull(),size:integer().notNull(),objectKey:text('object_key').notNull(),uploadId:text('upload_id'),status:text().notNull(),album:text(),created:integer().notNull(),taken:integer(),deleted:integer(),thumbnail:integer().notNull().default(0)},t=>[index('media_owner_created').on(t.owner,t.created)]);
export const parts=sqliteTable('parts',{media:text().notNull(),part:integer().notNull(),etag:text().notNull(),hash:text().notNull(),size:integer().notNull(),verified:integer().notNull().default(0)},t=>[primaryKey({columns:[t.media,t.part]})]);
export const shares=sqliteTable('shares',{media:text().notNull(),recipient:text().notNull()},t=>[primaryKey({columns:[t.media,t.recipient]}),index('shares_recipient').on(t.recipient)]);
