import { EventEmitter } from 'events';

// Central event bus for alert-related events across the backend
// Events:
// - 'alert_created' : { alert: any, unreadCount?: number }
// - 'alert_updated' : { id: string, status?: string, unreadCount?: number }
// - 'alert_deleted' : { id: string, unreadCount?: number }
// - 'alerts_unread_count' : { count: number }

export const alertEvents = new EventEmitter();

// Increase the max listeners to avoid warnings if multiple clients connect
alertEvents.setMaxListeners(50);
