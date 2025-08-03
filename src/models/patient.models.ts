import mongoose from 'mongoose';


const patientSchema = new mongoose.Schema({
    fullName: {
        type: String, // Not stored, but can be computed in queries if needed
    },
    dob: {
        type: String,
        required: true,
    },
    gender: {
        type: String,
        enum: ['male', 'female'],
        required: true,
    },
    maritalStatus: {
        type: String,
        default: ""
    },
    address: String,
    phone: {
        type: String, // Changed to String to support formats like "+233..."
    },
    email: String,
    occupation: String,
    alternatePhone: {
        type: String,
        default: ""
    },
    bloodType: {
        type: String,
        default: ""
    },
    allergies: [{
        type: String,
        default: ""
    }],
    chronicConditions:[ {
        type: String,
        default: ""
    }],
    currentMedications: {
        type: String,
        default: ""
    },
    familyHistory: {
        type: String,
        default: ""
    },
    familyOcularHistory: {
        type: String,
        default: ""
    },
    medicalHistory:[{
        type:String,
        default:""
    }],
    socialHistory:[
        {
            type:String,
            default:""
        }
    ],
    emergencyContactName: {
        type: String,
        default: ""
    },
    emergencyContactRelationship: {
        type: String,
        default: ""
    },
    emergencyContactPhone: {
        type: String,
        default: ""
    },
    referralSource: {
        type: String,
        default: ""
    },
    preferredCommunication: {
        type: String,
        default: ""
    },
    consentToTreatment: {
        type: Boolean,
        default: false
    },
    consentToShareInformation: {
        type: Boolean,
        default: false
    },
    acknowledgmentOfPrivacyPolicy: {
        type: Boolean,
        default: false
    },
    providerId: {
        type: String,
        default: ""
    },
    serviceNumber: String,
    emergencyName: String,
    emergencyPhone: {
        type: String,
    },
    lastVisit:{
        type:Date
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'archived','follow-up', 'deceased','pending'],
        default: 'active',
    },
    registeredAt: String,
    registeredInfo: String,
    patientId: {
        type: String,
        unique: true,
    },
    originalId: {
        type: Number,
        unique: true,
    },
}, {
    timestamps: true,
});

export const Patient = mongoose.models.Patient || mongoose.model('Patient', patientSchema);

