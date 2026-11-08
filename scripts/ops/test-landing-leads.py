import concurrent.futures
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('landing_leads', Path(__file__).with_name('landing-leads.py'))
leads = importlib.util.module_from_spec(spec)
spec.loader.exec_module(leads)

class IntakeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'leads.sqlite3'
        leads.initialize(self.path)
        self.body = {'site':'https://www.example.ru/path', 'telegram':'https://t.me/valid_user'}

    def tearDown(self):
        self.tmp.cleanup()

    def test_validation_and_no_side_effects(self):
        self.assertEqual(leads.validate(self.body), ('example.ru','@valid_user',False))
        self.assertEqual(leads.validate({'site':'пример.рф','telegram':'@valid_user'})[0], 'xn--e1afmkfd.xn--p1ai')
        for body in [None, [], {'site':'localhost','telegram':'@valid_user'}, {**self.body,'site':'https://user:pass@example.ru'}, {**self.body,'telegram':'bad contact'}, {**self.body,'auto':'true'}, {**self.body,'site':'127.0.0.1'}]:
            with self.assertRaises(ValueError):
                leads.save(self.path, body, '1')
        with leads.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM leads').fetchone()[0],0)

    def test_phone_contact_persists_and_deduplicates_across_formats(self):
        first = leads.save(self.path, {**self.body, 'telegram': '8 (999) 123-45-67'}, '1', '2', now=1000)
        second = leads.save(self.path, {**self.body, 'telegram': '+7 999 1234567'}, '1', '2', now=1001)
        self.assertEqual(first, (second[0], False))
        self.assertTrue(second[1])
        leads.initialize(self.path)
        with leads.connect(self.path) as db:
            rows = db.execute('SELECT telegram FROM leads').fetchall()
            self.assertEqual([row['telegram'] for row in rows], ['+79991234567'])
            self.assertEqual(db.execute('SELECT count(*) FROM notifications').fetchone()[0], 2)
        self.assertEqual(leads.normalize_contact('9991234567'), '+79991234567')
        self.assertEqual(leads.normalize_contact('+44 20 7946 0958'), '+442079460958')
        for value in ['', '12345', '+00000000', '@12345', 'abc +79991234567', '@@username', 'https://example.ru']:
            self.assertIsNone(leads.normalize_contact(value))

    def test_concurrent_duplicates_are_one_durable_lead(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: leads.save(self.path,self.body,'1','2',now=1000),range(8)))
        self.assertEqual(len({r[0] for r in results}),1)
        self.assertEqual(sum(not r[1] for r in results),1)
        leads.initialize(self.path)  # Simulate process restart; retain data/outbox.
        with leads.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM leads').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT count(*) FROM notifications').fetchone()[0],2)

    def test_autosave_only_primary_and_explicit_submit_also_secondary(self):
        leads.save(self.path,{**self.body,'auto':True},'1','2',now=1000)
        with leads.connect(self.path) as db:
            self.assertEqual([r[0] for r in db.execute('SELECT chat_id FROM notifications')],['1'])
        leads.save(self.path,self.body,'1','2',now=1001)
        with leads.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM notifications').fetchone()[0],3)

    def test_failed_notification_survives_restart_then_sends_once(self):
        leads.save(self.path,self.body,'1','1',now=1000)
        def failure(*_):
            raise urllib.error.URLError('simulated offline')
        leads.deliver(self.path,'fake-token',sender=failure,now=1000)
        leads.initialize(self.path)
        with leads.connect(self.path) as db:
            row=db.execute('SELECT * FROM notifications').fetchone()
            self.assertEqual((row['state'],row['attempts'],row['next_at']),('pending',1,1030))
            self.assertEqual(db.execute('SELECT count(*) FROM leads').fetchone()[0],1)
        sent=[]
        def success(_token,row):
            sent.append(row['lead_id'])
            return 123
        leads.deliver(self.path,'fake-token',sender=success,now=1029)
        self.assertEqual(sent,[])
        leads.deliver(self.path,'fake-token',sender=success,now=1030)
        leads.deliver(self.path,'fake-token',sender=success,now=1040)
        self.assertEqual(len(sent),1)
        with leads.connect(self.path) as db:
            row=db.execute('SELECT * FROM notifications').fetchone()
            self.assertEqual((row['state'],row['message_id']),('sent',123))

    def test_http_contract_and_origin_guard(self):
        server=leads.ThreadingHTTPServer(('127.0.0.1',0),leads.handler(self.path,'1','2',{'skyseo.site'}))
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base='http://127.0.0.1:'+str(server.server_port)
        def post(body,origin='https://skyseo.site'):
            req=urllib.request.Request(base+'/v1/api/lead',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':origin})
            try:
                with urllib.request.urlopen(req) as response:return response.status,json.load(response)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        try:
            self.assertEqual(post(self.body,'https://unrelated.invalid')[0],403)
            self.assertEqual(post({})[0],400)
            status,result=post(self.body)
            self.assertEqual(status,200)
            self.assertTrue(result['ok'])
            self.assertFalse(result['duplicate'])
            self.assertEqual(post(self.body)[1]['id'],result['id'])
            with urllib.request.urlopen(base+'/v1/api/health') as response:
                self.assertTrue(json.load(response)['ok'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_http2_notification_keeps_credentials_off_argv_and_verifies_hostname(self):
        row={'chat_id':'1','auto':False,'site':'example.ru','telegram':'@valid_user','lead_id':'test'}
        result=leads.subprocess.CompletedProcess([],0,'{"ok":true,"result":{"message_id":123}}\n200','')
        with patch.dict(leads.os.environ,{'SKYSEO_TELEGRAM_IPV4':'149.154.167.220'}), patch.object(leads.subprocess,'run',return_value=result) as call:
            self.assertEqual(leads.send_notification('fake-test-token',row),123)
        args=call.call_args.args[0]
        config=call.call_args.kwargs['input']
        self.assertNotIn('fake-test-token',' '.join(args))
        self.assertIn('https://api.telegram.org/botfake-test-token/sendMessage',config)
        self.assertIn('resolve = "api.telegram.org:443:149.154.167.220"',config)
        self.assertIn('\nhttp2\n',config)
        self.assertNotIn('insecure',config)
        self.assertEqual(args[:2],['curl','--disable'])
        with patch.object(leads.subprocess, 'run', return_value=result) as call:
            leads.send_notification('fake-test-token', {**row, 'telegram': '+79991234567'})
        line = next(line for line in call.call_args.kwargs['input'].splitlines() if line.startswith('data-binary = '))
        payload = json.loads(json.loads(line.removeprefix('data-binary = ')))
        self.assertIn('Телефон: +79991234567', payload['text'])
        self.assertNotIn('Telegram:', payload['text'])


if __name__=='__main__':
    unittest.main()
