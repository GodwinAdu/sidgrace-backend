import { Schema, Document, Model, models, model } from "mongoose";


export interface NotificationDocument extends Document {
  sendMode: string;
  recipients: Schema.Types.ObjectId[]; // Polymorphic reference
  type: 'EMAIL' | 'SMS';
  subject?: string;
  message: string;
  isScheduled: boolean;
  scheduledDate: Date;
  scheduledTime: string;
  selectedRole: string[];
  allContacts: boolean;
  status: "draft" | "published" | "pending" | "achieved";
  completed: boolean
  createdBy: Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<NotificationDocument>({
  sendMode: { type: String },
  recipients: { type: [Schema.Types.ObjectId], ref: 'Patient', required: true },
  type: { type: String, enum: ['EMAIL', 'SMS'], required: true },
  subject: { type: String },
  message: { type: String, required: true },
  isScheduled: { type: Boolean, default: false },
  scheduledDate: { type: Date },
  scheduledTime: { type: String },
  selectedRole: { type: [String] },
  allContacts: { type: Boolean, default: false },
  status: { type: String, enum: ["pending", "draft", "published", "achieved"] },
  completed: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "Staff" }
}, { timestamps: true });

type TypeModel = Model<NotificationDocument>;

const Notification: TypeModel = models.Notification ?? model<NotificationDocument>("Notification", NotificationSchema);

export default Notification;
