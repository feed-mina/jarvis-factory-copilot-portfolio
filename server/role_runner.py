"""Fixed no-tools Hermes invocation, stdin data only."""
import sys,json,os,contextlib
envelope=json.load(sys.stdin)
def read_usage(agent):
    """Token/cost counters the Hermes agent keeps for this one call. Missing counters stay None, never 0."""
    def n(name,kind=int):
        v=getattr(agent,'session_'+name,None)
        return kind(v) if isinstance(v,(int,float)) and not isinstance(v,bool) else None
    status=getattr(agent,'session_cost_status',None)
    # A finished model call always uses tokens, so 0/0 means the provider reported nothing: keep it unknown.
    known=(n('input_tokens') or 0)+(n('output_tokens') or 0)>0
    if not known:return {'input_tokens':None,'output_tokens':None,'total_tokens':None,'cache_read_tokens':None,'reasoning_tokens':None,'api_calls':n('api_calls'),'cost_usd':None,'cost_status':None,'source':None}
    return {'input_tokens':n('input_tokens'),'output_tokens':n('output_tokens'),'total_tokens':n('total_tokens'),
      'cache_read_tokens':n('cache_read_tokens'),'reasoning_tokens':n('reasoning_tokens'),'api_calls':n('api_calls'),
      'cost_usd':n('estimated_cost_usd',float) if known and status not in (None,'','unknown') else None,
      'cost_status':status if isinstance(status,str) and status else None,'source':'hermes-agent-session' if known else None}
try:
    with open(os.devnull,'w') as sink,contextlib.redirect_stdout(sink),contextlib.redirect_stderr(sink):
        from dotenv import load_dotenv
        load_dotenv('/opt/data/.env',override=False)
        from hermes_cli.config import load_config
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from run_agent import AIAgent
        m=load_config()['model'];r=resolve_runtime_provider(requested=m['provider'],target_model=m['default'])
        a=AIAgent(model=m['default'],provider=r.get('provider'),base_url=r.get('base_url'),api_key=r.get('api_key'),api_mode=r.get('api_mode'),enabled_toolsets=[],max_iterations=1,max_tokens=2200,quiet_mode=True,save_trajectories=False,verbose_logging=False,skip_context_files=True,skip_memory=True,skip_background_review=True,load_soul_identity=False,checkpoints_enabled=False)
        if getattr(a,'tools',None):raise RuntimeError('Tools must be disabled')
        result=a.run_conversation(json.dumps({'untrusted_data':envelope['data']},ensure_ascii=False),system_message=envelope['prompt'])
        text=str(result.get('final_response','')).strip()
        if text.startswith('```'):text=text.split('\n',1)[1].rsplit('```',1)[0].strip()
        parsed=json.loads(text)
        usage=read_usage(a)
    print(json.dumps({'result':parsed,'model':m['default'],'usage':usage,'provider':m['provider']},ensure_ascii=False))
except Exception as e:
    print(json.dumps({'error':type(e).__name__}));sys.exit(1)
