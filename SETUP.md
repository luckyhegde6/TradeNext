# 🛠️ Prisma Postgres Setup Guide

Congratulations, you just deployed the Next.js + Prisma Postgres starter template 🎉

To make the app work, you need to connect it to a database.

## 1. Create a Prisma Postgres instance

Create a new Prisma Postgres database instance:

1.  Go to [Prisma Console](https://console.prisma.io).
2.  Click **New project** to create a new project.
3.  Enter a name for your project in the **Name** field.
4.  Inside the **Prisma Postgres** section, click **Get started**.
5.  Choose a region close to your location from the **Region** dropdown.
6.  Click **Create project** to set up your database.

## 2. Add the Prisma integration token to Netlify

When you created the site with this template, you already installed the [Prisma Postgres extension](https://app.netlify.com/extensions/prisma-postgres) in your Netlify account. Next, you need to copy Prisma's integration token into the extension in your Neltify Dashboard:

1.  In the [Prisma Console](https://console.prisma.io), navigate to the root of your Workspace and click the **Integrations** tab in the left-hand sidenav.
2.  In the **Configure Team settings** section, click the **Generate integration token** button.
3.  Copy the generated token, you now need to add it to the team-level extension configuration in your Netlify account as described in the next step.
4.  In your Netlify account, click the **Extensions** tab in the left-hand sidenav and navigate to the installed **Prisma Postgres** extension. Then find the text field for the **Integration token**, paste the token from the previous step into it and click **Save**.

## 3. Connect Netlify site with Prisma Postgres instance

In this step, you will connect your Netlify site with the Prisma Postgres instance you just created:

1.  In your Netlify Dashboard, click on the **Sites** item in the left-hand sidenav and click on the site that was deployed with this template.
2.  In the **Extensions** section, click on **Prisma Postgres**.
3.  Find the **Project** dropdown and select the one project created in **Step 1** before.
4.  In the next two dropdowns for **Production environment** and **Preview environment** select **Development**. Then click **Save**. (At this stage, you can theoretically connect different database instances to the different environments in Netlify. For the purpose of this demo, we are just connecting both environments to the **Development** database in Prisma Console).

## 4. Re-deploy the site in Netlify

Your site is now fully configured to load data from the Prisma Postgres database you just created, the last thing you need to do is re-deploy the site via the Netlify Dashboard.

1.  In your Netlify Dashboard, click on the **Sites** item in the left-hand sidenav and click on the site that was deployed with this template.
2.  Find the **Project** dropdown and select the one project created in **Step 1** before.
3.  Click on the **Deploys** tab on the left, click the **Trigger deploy** button, and finally click **Clear cache and deploy site**.

Once the deployment is ready, you can click on **Open production deploy** and use the app by creating users and posts via the UI 🎉
