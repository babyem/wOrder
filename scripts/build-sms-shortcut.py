"""
Bygger genvägen "wOrder SMS" (Genvägar på iPhone/Mac) och signerar den så att
den kan importeras: public/wOrder SMS.shortcut. Se docs/sms-genvag.md.

Genvägen tar JSON {id, phone, body, confirm} från SmsLink, skickar SMS:et
utan att visa Meddelanden och POST:ar {id} till confirm (/api/sms-sent).

Kör på en Mac (kräver `shortcuts sign`, inloggad på iCloud):
    python3 scripts/build-sms-shortcut.py
"""
import os, subprocess, tempfile
import plistlib, uuid

U = lambda: str(uuid.uuid4()).upper()
DICT = U()
OBJ = '￼'

def out(uid, name):
    return {'Type': 'ActionOutput', 'OutputUUID': uid, 'OutputName': name}

def attach(uid, name):
    return {'Value': out(uid, name), 'WFSerializationType': 'WFTextTokenAttachment'}

def token(uid, name):
    return {'Value': {'string': OBJ, 'attachmentsByRange': {'{0, 1}': out(uid, name)}},
            'WFSerializationType': 'WFTextTokenString'}

def text(s):
    return {'Value': {'string': s}, 'WFSerializationType': 'WFTextTokenString'}

actions = [
    {'WFWorkflowActionIdentifier': 'is.workflow.actions.detect.dictionary',
     'WFWorkflowActionParameters': {
         'UUID': DICT,
         'WFInput': {'Value': {'Type': 'ExtensionInput'}, 'WFSerializationType': 'WFTextTokenAttachment'}}},
]
vals = {}
for key in ['phone', 'body', 'id', 'confirm']:
    vals[key] = U()
    actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
                    'WFWorkflowActionParameters': {
                        'UUID': vals[key],
                        'CustomOutputName': key,
                        'WFGetDictionaryValueType': 'Value',
                        'WFDictionaryKey': key,
                        'WFInput': attach(DICT, 'Dictionary')}})

actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.sendmessage',
                'WFWorkflowActionParameters': {
                    'UUID': U(),
                    'ShowWhenRun': False,
                    'WFSendMessageContent': token(vals['body'], 'body'),
                    'WFSendMessageActionRecipients': attach(vals['phone'], 'phone')}})

actions.append({'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
                'WFWorkflowActionParameters': {
                    'UUID': U(),
                    'ShowHeaders': True,
                    'WFURL': token(vals['confirm'], 'confirm'),
                    'WFHTTPMethod': 'POST',
                    'WFHTTPBodyType': 'JSON',
                    'WFJSONValues': {'Value': {'WFDictionaryFieldValueItems': [
                        {'WFItemType': 0, 'WFKey': text('id'), 'WFValue': token(vals['id'], 'id')}]},
                        'WFSerializationType': 'WFDictionaryFieldValue'}}})

wf = {
    'WFWorkflowActions': actions,
    'WFWorkflowClientVersion': '3600.0.5',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59511, 'WFWorkflowIconStartColor': 4292093695},
    'WFWorkflowImportQuestions': [],
    'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowTypes': [],
    'WFQuickActionSurfaces': [],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowHasOutputFallback': False,
}
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
target = os.path.join(root, 'public', 'wOrder SMS.shortcut')
with tempfile.TemporaryDirectory() as tmp:
    unsigned = os.path.join(tmp, 'unsigned.shortcut')
    with open(unsigned, 'wb') as f:
        plistlib.dump(wf, f, fmt=plistlib.FMT_BINARY)
    # Filnamnet blir genvägens namn vid import
    subprocess.run(['shortcuts', 'sign', '-m', 'anyone', '-i', unsigned, '-o', target], check=True)
os.chmod(target, 0o644)
print('Skrev', target)
