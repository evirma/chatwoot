require 'csv'
require 'json'
require 'optparse'

# EVIRMA: one-off step after the SaleBot import. SaleBot's evirma_user_id came from an extension link and was
# never verified, so it goes only into the claimed_evirma_user_id attribute that the support panel shows as
# unconfirmed; the contact identifier (verified identity) is never touched.
class EvirmaSalebotClaimedUser
  ACCOUNT_ID = 1
  ATTRIBUTE = 'claimed_evirma_user_id'.freeze
  UUID = /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/

  def self.run(argv = ARGV, output: $stdout)
    options = { apply: false }
    args = argv.dup
    args.shift if args.first == '--'
    OptionParser.new do |cli|
      cli.banner = 'rails runner deploy/evirma/salebot/claimed_user.rb -- --links FILE [--apply]'
      cli.on('--links FILE') { |value| options[:links] = value }
      cli.on('--apply') { options[:apply] = true }
    end.parse!(args)
    raise OptionParser::MissingArgument, '--links' unless options[:links]

    new(links: options[:links], apply: options[:apply], output: output).perform
  end

  def initialize(links:, apply:, output:)
    @links = links
    @apply = apply
    @output = output
  end

  # The links CSV has chatwoot_contact_id and evirma_user_id; rows are checked against Evirma users beforehand.
  def perform
    account = Account.find(ACCOUNT_ID)
    stats = Hash.new(0)
    CSV.foreach(@links, headers: true) do |row|
      stats[link(account, row['chatwoot_contact_id'].to_i, row['evirma_user_id'].to_s.downcase)] += 1
    end
    @output.puts JSON.generate(mode: @apply ? 'apply' : 'dry-run', totals: stats)
    stats
  end

  private

  def link(account, contact_id, user_id)
    return 'skipped_bad_user_id' unless UUID.match?(user_id)

    contact = account.contacts.find_by(id: contact_id)
    return 'skipped_missing_contact' unless contact

    current = contact.custom_attributes[ATTRIBUTE]
    return 'already_set' if current == user_id
    return 'skipped_other_claim' if current.present?

    contact.update!(custom_attributes: contact.custom_attributes.merge(ATTRIBUTE => user_id)) if @apply
    'set'
  end
end

EvirmaSalebotClaimedUser.run if $PROGRAM_NAME == __FILE__
