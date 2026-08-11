module.exports = async ({github, context, core}) => {
  const fieldName = process.env.FIELD_NAME || "Iteration";
  const issueNodeId = context.payload.issue.node_id;

  const q1 = `
    query($id: ID!) {
      node(id: $id) {
        ... on Issue {
          projectItems(first: 20) {
            nodes {
              id
              project { id title }
            }
          }
        }
      }
    }`;
  const res1 = await github.graphql(q1, { id: issueNodeId });
  const items = res1.node.projectItems.nodes;

  if (items.length === 0) {
    core.info("Issue is not linked to any Project (v2). Nothing to do.");
    return;
  }

  for (const item of items) {
    const projectId = item.project.id;

    const q2 = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2IterationField {
                  id
                  name
                  configuration {
                    iterations { id title startDate duration }
                  }
                }
              }
            }
          }
        }
      }`;
    const res2 = await github.graphql(q2, { projectId });
    const iterField = res2.node.fields.nodes.find(f => f.name === fieldName);
    if (!iterField) {
      core.info(`No field named "${fieldName}" on project "${item.project.title}", skipping.`);
      continue;
    }

    const today = new Date();
    const current = iterField.configuration.iterations.find(it => {
      const start = new Date(it.startDate);
      const end = new Date(start);
      end.setDate(end.getDate() + it.duration);
      return today >= start && today < end;
    });

    if (!current) {
      core.info(`No current iteration found for project "${item.project.title}".`);
      continue;
    }

    const mutation = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { iterationId: $iterationId }
        }) {
          projectV2Item { id }
        }
      }`;
    await github.graphql(mutation, {
      projectId,
      itemId: item.id,
      fieldId: iterField.id,
      iterationId: current.id
    });

    core.info(`✅ ${item.project.title} → set to iteration "${current.title}"`);
  }
};
