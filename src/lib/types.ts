export type Role = 'ADMIN' | 'STAFF';
export type ThreadState = 'OPEN' | 'ARCHIVED' | 'SPAM' | 'TRASH';

export type Me = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  role: Role;
};

export type MailboxMember = {
  userId: string;
  canSend: boolean;
  user?: { firstName: string; lastName: string; email: string; avatarUrl?: string | null };
};

export type Mailbox = {
  id: string;
  address: string;
  displayName: string;
  description?: string | null;
  avatarUrl?: string | null;
  isCatchAll: boolean;
  isActive: boolean;
  sortOrder: number;
  signature?: string | null;
  autoReplyEnabled: boolean;
  autoReplySubject?: string | null;
  autoReplyBody?: string | null;
  members?: MailboxMember[];
};

export type Assignee = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
};

export type ThreadSummary = {
  id: string;
  subject: string;
  snippet: string;
  participant: string;
  participantName?: string | null;
  state: ThreadState;
  isRead: boolean;
  isStarred: boolean;
  messageCount: number;
  hasAttachments: boolean;
  lastMessageAt: string;
  mailbox: { id: string; address: string; displayName: string };
  assignedTo?: Assignee | null;
};

export type MailAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url?: string | null;
  isInline: boolean;
};

export type MailMessageView = {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  fromName?: string | null;
  fromEmail: string;
  toEmails: string[];
  ccEmails: string[];
  bccEmails?: string[];
  subject: string;
  text?: string | null;
  html?: string | null;
  deliveryError?: string | null;
  createdAt: string;
  attachments: MailAttachmentView[];
};

export type ThreadDetail = ThreadSummary & {
  mailbox: Mailbox;
  messages: MailMessageView[];
  /** False for someone given read-only access to this address. */
  canSend?: boolean;
};

export type Counts = {
  unread: Record<string, number>;
  totalUnread: number;
  starred: number;
  sent: number;
  archived: number;
  spam: number;
  trash: number;
};

export type Staff = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
};

export type StaffAccount = Staff & {
  role: Role;
  isActive: boolean;
  phone?: string | null;
  lastLoginAt?: string | null;
  mailboxAccess?: { mailboxId: string }[];
};

export type Attachment = { fileName: string; url: string; mimeType?: string };
