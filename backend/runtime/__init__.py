__all__ = ["AgentRunner", "WorkflowExecutor"]


def __getattr__(name):
    if name == "AgentRunner":
        from .agent_runner import AgentRunner

        return AgentRunner
    if name == "WorkflowExecutor":
        from .graph_builder import WorkflowExecutor

        return WorkflowExecutor
    raise AttributeError(name)
