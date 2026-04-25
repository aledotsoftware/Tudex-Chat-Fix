const { MessageMedia } = require('whatsapp-web.js');
const { BaseAdapter } = require('./base-adapter');

class WhatsAppAdapter extends BaseAdapter {
  constructor(options) {
    super('whatsapp');
    this.client = options.client;
    this.getStatusFn = options.getStatus;
    this.isReadyFn = options.isReady;
    this.markReadFn = options.markRead;
  }

  isReady() {
    return Boolean(this.isReadyFn?.());
  }

  getStatus() {
    return String(this.getStatusFn?.() || 'unknown');
  }

  async listChats() {
    return this.client.getChats();
  }

  async fetchMessages({ conversationId, limit = 80 }) {
    const chat = await this.client.getChatById(conversationId);
    if (!chat) return [];
    return chat.fetchMessages({ limit });
  }

  async markRead({ conversationId }) {
    if (typeof this.markReadFn === 'function') {
      return this.markReadFn({ conversationId });
    }
    const chat = await this.client.getChatById(conversationId);
    if (chat) {
      await chat.sendSeen();
    }
  }

  async sendMessage(params) {
    let {
      chatId,
      text,
      replyToMessageId,
      mediaUrl,
      mediaBase64,
      mediaName = 'image.jpg',
      mediaMimeType = 'image/jpeg'
    } = params;

    // 1. Auto-resolve WhatsApp Channel URLs or bare invite codes
    const isChannelUrl = chatId.includes('whatsapp.com/channel/');
    const looksLikeInviteCode = !chatId.includes('@') && /^[A-Za-z0-9_-]{10,}$/.test(chatId);

    if (isChannelUrl || looksLikeInviteCode) {
      const parts = chatId.split('/channel/');
      const code = (parts.length > 1 ? parts[1] : chatId).split('?')[0].trim();

      try {
        console.log(`🔍 Resolving channel for invite code: ${code}...`);

        // Call queryNewsletterMetadataByInviteCode directly
        const page = this.client.pupPage;
        const channelData = await page.evaluate(async (inviteCode) => {
          try {
            // Direct Store call
            const response = await window.Store.ChannelUtils.queryNewsletterMetadataByInviteCode(inviteCode);
            if (response && response.idJid) {
              const name = response.newsletterNameMetadataMixin?.nameElementValue || null;
              return { id: response.idJid, name };
            }
            return null;
          } catch (err) {
            if (err.name === 'ServerStatusCodeError') return null;
            return { error: err.message || String(err) };
          }
        }, code);

        if (channelData && channelData.error) {
          throw new Error(`Channel resolution failed: ${channelData.error}`);
        }

        if (channelData && channelData.id) {
          chatId = channelData.id;
          console.log(`✅ Channel resolved: ${channelData.name || 'Newsletter'} → ${chatId}`);
        } else {
          console.warn('⚠️ Channel metadata returned empty for:', code);
          throw new Error(`Channel not found: Could not resolve invite code: ${code}`);
        }
      } catch (err) {
        console.error('❌ Channel resolution failed:', err.message || err);
        throw new Error(`Channel resolution failed: ${err.message || 'Unknown error resolving invite code'}`);
      }
    }

    if (!chatId || (!text && !mediaUrl && !mediaBase64)) {
      throw new Error('Missing parameters (chatId + text/media)');
    }

    // 2. Build send options
    const isNewsletter = chatId.includes('@newsletter');
    const sendOptions = {};
    if (replyToMessageId && !isNewsletter) {
      sendOptions.quotedMessageId = replyToMessageId;
    }

    // 3. Send
    if (isNewsletter) {
      // Newsletter: bypass client.sendMessage which crashes on getChat()
      // Send directly through WhatsApp Web internal Store
      let mediaData = null;
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          throw new Error('Failed to process media content');
        }
        mediaData = { data: media.data, mimetype: media.mimetype, filename: media.filename || 'file' };
      }

      const sendResult = await this.client.pupPage.evaluate(async (newsletterId, content, mediaInfo) => {
        try {
          // Get or load the channel chat object from the Store directly
          const chatWid = window.Store.WidFactory.createWid(newsletterId);
          let chat = window.Store.WAWebNewsletterMetadataCollection.get(newsletterId);
          if (!chat) {
            await window.Store.ChannelUtils.loadNewsletterPreviewChat(newsletterId);
            chat = await window.Store.WAWebNewsletterMetadataCollection.find(chatWid);
          }
          if (!chat) return { error: 'Could not load channel chat object' };

          // Process media if provided
          let mediaOptions = {};
          let mediaHandle = null;
          if (mediaInfo) {
            const processedMedia = await window.WWebJS.processMediaData(mediaInfo, {
              sendToChannel: true
            });
            mediaOptions = processedMedia.toJSON ? processedMedia.toJSON() : processedMedia;
            mediaHandle = mediaOptions.mediaHandle || null;
          }

          // Build message
          const meUser = window.Store.User.getMaybeMePnUser();
          const newId = await window.Store.MsgKey.newId();
          const newMsgKey = new window.Store.MsgKey({
            from: meUser, to: chat.id, id: newId, selfDir: 'out'
          });

          const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);
          const msgBody = mediaInfo ? (content || '') : content;
          const message = {
            id: newMsgKey, ack: 0, body: mediaInfo ? '' : content,
            from: meUser, to: chat.id, local: true, self: 'out',
            t: parseInt(new Date().getTime() / 1000), isNewMsg: true, type: 'chat',
            ...ephemeralFields, ...mediaOptions,
            ...(mediaInfo && content ? { caption: content } : {})
          };

          const msg = new window.Store.Msg.modelClass(message);
          const msgData = window.Store.SendChannelMessage.msgDataFromMsgModel(msg);
          const isMedia = mediaInfo != null;
          await window.Store.SendChannelMessage.addNewsletterMsgsRecords([msgData]);
          if (chat.msgs) chat.msgs.add(msg);
          if (chat.t !== undefined) chat.t = msg.t;

          const sendResponse = await window.Store.SendChannelMessage.sendNewsletterMessageJob({
            msg, type: message.type === 'chat' ? 'text' : isMedia ? 'media' : 'text',
            newsletterJid: chat.id.toJid(),
            ...(isMedia ? { mediaMetadata: msg.avParams(), mediaHandle } : {})
          });

          if (sendResponse.success) {
            msg.t = sendResponse.ack.t;
            msg.serverId = sendResponse.serverId;
          }
          msg.updateAck(1, true);
          await window.Store.SendChannelMessage.updateNewsletterMsgRecord(msg);

          return { success: true, serverId: sendResponse.serverId || null };
        } catch (err) {
          return { error: err.message || String(err) };
        }
      }, chatId, text, mediaData);

      if (sendResult && sendResult.error) {
        throw new Error(`Failed to send to channel: ${sendResult.error}`);
      }
    } else {
      // Regular chat: use client.sendMessage as usual
      if (mediaUrl || mediaBase64) {
        let media;
        if (mediaUrl) {
          media = await MessageMedia.fromUrl(mediaUrl).catch(e => {
            console.error('❌ Failed to fetch media from URL:', e.message);
            return null;
          });
        } else {
          media = new MessageMedia(mediaMimeType, mediaBase64, mediaName);
        }
        if (!media) {
          throw new Error('Failed to process media content');
        }
        await this.client.sendMessage(chatId, media, { ...sendOptions, caption: text || undefined });
      } else {
        await this.client.sendMessage(chatId, text, sendOptions);
      }
    }

    return {
      success: true,
      chatId,
      isNewsletter
    };
  }
}

module.exports = { WhatsAppAdapter };
